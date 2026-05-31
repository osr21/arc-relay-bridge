/**
 * YieldVault interaction library.
 *
 * Provides typed helpers for reading vault data from any chain's RPC
 * and for depositing/withdrawing via the connected MetaMask wallet.
 */

import { ethers } from "ethers";
import { ChainConfig, CHAINS } from "./chains";
import { getProvider, switchToChain, friendlyError } from "./bridge";

export const VAULT_ABI = [
  "function apyBps() view returns (uint256)",
  "function vaultName() view returns (string)",
  "function totalDeposited() view returns (uint256)",
  "function currentValue(address user) view returns (uint256)",
  "function pendingYield(address user) view returns (uint256)",
  "function positions(address user) view returns (uint256 principal, uint256 checkpointYield, uint256 lastTimestamp)",
  "function deposit(uint256 amount)",
  "function withdraw() returns (uint256 received)",
  "event Deposited(address indexed user, uint256 amount, uint256 newPrincipal)",
  "event Withdrawn(address indexed user, uint256 principal, uint256 yieldPaid, uint256 total)",
];

export const USDC_APPROVE_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
];

/**
 * Vault addresses deployed by scripts/src/deployYield.ts.
 * Updated after deployment — keyed by chain ID.
 */
export const VAULT_ADDRESSES: Record<number, string> = {
  5042002:  "0x9677b4BB48B552E7042619056414Fe69d2b5e204", // Arc Testnet       — 18.5% APY
  11155111: "0xCD75dad98b3bC9bb3Bb153b623772967e77d56F1", // Ethereum Sepolia  —  7.8% APY
  84532:    "0xDE761A1b0FC1271AF2D1682158D428Bd12DC710d", // Base Sepolia      — 12.3% APY
  43113:    "0x57a298356E6B2A98d44C68Ff92B7372D639684E0", // Avalanche Fuji    —  9.2% APY
};

export interface VaultRate {
  chain: ChainConfig;
  vaultAddress: string;
  apyBps: number;
  apyPercent: string;
  totalDeposited: bigint;
  isDeployed: boolean;
}

export interface VaultPosition {
  chain: ChainConfig;
  vaultAddress: string;
  principal: bigint;
  pendingYield: bigint;
  currentValue: bigint;
  depositedAt: number;
}

/** Whether a vault address has been deployed (not a placeholder). */
export function isVaultDeployed(chainId: number): boolean {
  const addr = VAULT_ADDRESSES[chainId];
  return !!addr && !addr.startsWith("PLACEHOLDER");
}

/** Format a USDC units value (6 decimals) to display string (e.g. "1.23"). */
export function fmtUsdc(units: bigint): string {
  const whole = units / 1_000_000n;
  const frac  = units % 1_000_000n;
  return `${whole}.${frac.toString().padStart(6, "0").slice(0, 2)}`;
}

/** Format APY bps to a percent string, e.g. 1850 → "18.50". */
export function fmtApy(bps: number): string {
  return (bps / 100).toFixed(2);
}

/**
 * Read vault rates (APY + TVL) for all chains.
 * Uses the API server for batched reads (avoids browser CORS).
 */
export async function fetchAllRates(): Promise<VaultRate[]> {
  const res  = await fetch("/api/yield/rates");
  const data = await res.json() as {
    vaults: Array<{
      chainId: number;
      apyBps: string;
      apyPercent: string;
      totalDeposited: string;
      vaultAddress: string;
    }>;
  };

  return data.vaults
    .map((v) => {
      const chain = Object.values(CHAINS).find((c) => c.id === v.chainId);
      if (!chain) return null;
      return {
        chain,
        vaultAddress: v.vaultAddress,
        apyBps: Number(v.apyBps),
        apyPercent: v.apyPercent,
        totalDeposited: BigInt(v.totalDeposited),
        isDeployed: !v.vaultAddress.startsWith("PLACEHOLDER"),
      } satisfies VaultRate;
    })
    .filter((v): v is VaultRate => v !== null);
}

/**
 * Read a user's position on a single chain.
 * Uses a static JSON-RPC provider (no wallet needed).
 */
export async function fetchPosition(
  chain: ChainConfig,
  userAddress: string
): Promise<VaultPosition | null> {
  const vaultAddress = VAULT_ADDRESSES[chain.id];
  if (!vaultAddress || vaultAddress.startsWith("PLACEHOLDER")) return null;

  const urls = [chain.rpcUrl, ...chain.rpcFallbacks];
  for (const url of urls) {
    try {
      const provider = new ethers.JsonRpcProvider(url);
      const vault    = new ethers.Contract(vaultAddress, VAULT_ABI, provider);
      const [pos, cv, py] = await Promise.all([
        vault.positions(userAddress) as Promise<{ principal: bigint; checkpointYield: bigint; lastTimestamp: bigint }>,
        vault.currentValue(userAddress) as Promise<bigint>,
        vault.pendingYield(userAddress) as Promise<bigint>,
      ]);
      if (pos.principal === 0n) return null;
      return {
        chain,
        vaultAddress,
        principal:    pos.principal,
        pendingYield: py,
        currentValue: cv,
        depositedAt:  Number(pos.lastTimestamp),
      };
    } catch {
      // try next RPC
    }
  }
  return null;
}

/**
 * Read positions across all chains for a wallet address.
 * Returns only chains where the user has a position.
 */
export async function fetchAllPositions(userAddress: string): Promise<VaultPosition[]> {
  const results = await Promise.all(
    Object.values(CHAINS).map((chain) => fetchPosition(chain, userAddress))
  );
  return results.filter((p): p is VaultPosition => p !== null);
}

export type DepositStep =
  | "idle"
  | "switching"
  | "approving"
  | "depositing"
  | "done"
  | "error";

export interface DepositStatus {
  step: DepositStep;
  message: string;
  txHash?: string;
  error?: string;
}

/**
 * Deposit USDC into a chain's YieldVault.
 * Handles chain switching, approval, and deposit in sequence.
 */
export async function depositToVault(
  chain: ChainConfig,
  amountUnits: bigint,
  onStatus: (s: DepositStatus) => void
): Promise<string> {
  const vaultAddress = VAULT_ADDRESSES[chain.id];
  if (!vaultAddress || vaultAddress.startsWith("PLACEHOLDER")) {
    throw new Error(`YieldVault not deployed on ${chain.name}`);
  }

  onStatus({ step: "switching", message: `Switching to ${chain.name}…` });
  await switchToChain(chain);

  const provider = await getProvider();
  const signer   = await provider.getSigner();
  const signerAddress = await signer.getAddress();

  const usdc  = new ethers.Contract(chain.usdcAddress, USDC_APPROVE_ABI, signer);
  const vault = new ethers.Contract(vaultAddress, VAULT_ABI, signer);

  onStatus({ step: "approving", message: "Checking USDC allowance…" });
  const allowance: bigint = await usdc.allowance(signerAddress, vaultAddress);
  if (allowance < amountUnits) {
    onStatus({ step: "approving", message: "Approving USDC for vault…" });
    const approveTx = await usdc.approve(vaultAddress, amountUnits);
    onStatus({ step: "approving", message: "Waiting for approval confirmation…", txHash: approveTx.hash });
    await approveTx.wait();
  }

  onStatus({ step: "depositing", message: "Depositing USDC into vault…" });
  const depositTx = await vault.deposit(amountUnits);
  onStatus({ step: "depositing", message: "Waiting for deposit confirmation…", txHash: depositTx.hash });
  await depositTx.wait();

  onStatus({ step: "done", message: "Deposited successfully!", txHash: depositTx.hash });
  return depositTx.hash as string;
}

/**
 * Withdraw the full position from a chain's YieldVault.
 * Returns the amount received in USDC units.
 */
export async function withdrawFromVault(
  chain: ChainConfig,
  onStatus: (s: DepositStatus) => void
): Promise<{ txHash: string; received: bigint }> {
  const vaultAddress = VAULT_ADDRESSES[chain.id];
  if (!vaultAddress || vaultAddress.startsWith("PLACEHOLDER")) {
    throw new Error(`YieldVault not deployed on ${chain.name}`);
  }

  onStatus({ step: "switching", message: `Switching to ${chain.name}…` });
  await switchToChain(chain);

  const provider = await getProvider();
  const signer   = await provider.getSigner();
  const vault    = new ethers.Contract(vaultAddress, VAULT_ABI, signer);

  onStatus({ step: "depositing", message: "Withdrawing from vault…" });
  const tx = await vault.withdraw();
  onStatus({ step: "depositing", message: "Waiting for withdrawal confirmation…", txHash: tx.hash });
  const receipt = await tx.wait();

  // Parse Withdrawn event to get the received amount
  const iface    = new ethers.Interface(VAULT_ABI);
  let received   = 0n;
  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog(log);
      if (parsed?.name === "Withdrawn") {
        received = parsed.args[3] as bigint; // total field
        break;
      }
    } catch { /* not this log */ }
  }

  onStatus({ step: "done", message: "Withdrawn successfully!", txHash: tx.hash });
  return { txHash: tx.hash as string, received };
}

const BALANCE_ABI = ["function balanceOf(address) view returns (uint256)"];

/**
 * Read the wallet's USDC balance on every chain simultaneously.
 * Uses each chain's public RPC — no wallet connection needed.
 * Returns a map of chainId → USDC units (6 decimals).
 */
export async function fetchUsdcBalances(
  userAddress: string
): Promise<Record<number, bigint>> {
  const entries = await Promise.all(
    Object.values(CHAINS).map(async (chain): Promise<[number, bigint]> => {
      const urls = [chain.rpcUrl, ...chain.rpcFallbacks];
      for (const url of urls) {
        try {
          const provider = new ethers.JsonRpcProvider(url);
          const usdc = new ethers.Contract(chain.usdcAddress, BALANCE_ABI, provider);
          const bal = await Promise.race<bigint>([
            usdc.balanceOf(userAddress) as Promise<bigint>,
            new Promise<never>((_, rej) =>
              setTimeout(() => rej(new Error("timeout")), 7000)
            ),
          ]);
          return [chain.id, bal];
        } catch {
          // try next RPC or fall through to 0n
        }
      }
      return [chain.id, 0n];
    })
  );
  return Object.fromEntries(entries);
}

/** User-friendly error message for vault interactions. */
export { friendlyError };
