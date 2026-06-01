/**
 * Paymaster interaction library.
 *
 * Provides typed helpers for reading paymaster balances and for
 * depositing / withdrawing via the connected MetaMask wallet.
 */

import { ethers } from "ethers";
import { ChainConfig, CHAINS } from "./chains";
import { getProvider, switchToChain, friendlyError } from "./bridge";

export const PAYMASTER_ABI = [
  "function balances(address user) view returns (uint256)",
  "function locked(address user) view returns (uint256)",
  "function gasRate() view returns (uint256)",
  "function paused() view returns (bool)",
  "function MAX_DEDUCTION_PER_TX() view returns (uint256)",
  "function deposit(uint256 amount)",
  "function withdraw(uint256 amount)",
  "event Deposited(address indexed user, uint256 amount, uint256 newBalance)",
  "event Withdrawn(address indexed user, uint256 amount, uint256 remaining)",
  "event GasSponsored(address indexed user, uint256 usdcDeducted, uint256 remainingBalance)",
];

export const USDC_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
];

/**
 * Paymaster addresses deployed by scripts/src/deployPaymaster.ts.
 * Keyed by chain ID. Empty string = not yet deployed on that chain.
 */
export const PAYMASTER_ADDRESSES: Record<number, string> = {
  5042002:  "0xfD06D288d481515a986DF28030AF013De290D76C", // Arc Testnet     (v5)
  11155111: "0xC9E9ba0bfE58FA438B8B6f2182d3ADA3669F9Eb4", // Ethereum Sepolia (v5)
  84532:    "0xe355E9dCdEAB37eA8fd81b9457Ad2C56d3eE9055", // Base Sepolia     (v5)
  43113:    "0x7C75A75B59b63871e1Bb47fA63e541F0e5975f93", // Avalanche Fuji   (v5)
};

export function isPaymasterDeployed(chainId: number): boolean {
  const addr = PAYMASTER_ADDRESSES[chainId];
  return !!addr && addr.length === 42 && addr !== "0x0000000000000000000000000000000000000000";
}

export interface PaymasterBalance {
  chain: ChainConfig;
  paymasterAddress: string;
  balance: bigint;
  gasRate: bigint;
  paused: boolean;
  isDeployed: boolean;
}

export interface PaymasterStatus {
  step: "idle" | "switching" | "approving" | "depositing" | "withdrawing" | "done" | "error";
  message: string;
  txHash?: string;
  error?: string;
}

/** Fetch the user's USDC gas deposit balance from one chain's paymaster. */
async function fetchBalance(chain: ChainConfig, userAddress: string): Promise<PaymasterBalance> {
  const addr = PAYMASTER_ADDRESSES[chain.id];
  if (!isPaymasterDeployed(chain.id)) {
    return { chain, paymasterAddress: addr ?? "", balance: 0n, gasRate: 0n, paused: false, isDeployed: false };
  }

  const rpcUrl  = chain.rpcUrl ?? getChainRpc(chain.id);
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const contract = new ethers.Contract(addr, PAYMASTER_ABI, provider);

  const [balance, gasRate, paused] = await Promise.all([
    contract.balances(userAddress) as Promise<bigint>,
    contract.gasRate()             as Promise<bigint>,
    contract.paused()              as Promise<boolean>,
  ]);

  return { chain, paymasterAddress: addr, balance, gasRate, paused, isDeployed: true };
}

function getChainRpc(chainId: number): string {
  const rpcs: Record<number, string> = {
    5042002:  "https://rpc.drpc.testnet.arc.network",
    11155111: "https://ethereum-sepolia-rpc.publicnode.com",
    84532:    "https://sepolia.base.org",
    43113:    "https://api.avax-test.network/ext/bc/C/rpc",
  };
  return rpcs[chainId] ?? "";
}

/** Fetch paymaster balances across all chains for a user. */
export async function fetchAllBalances(userAddress: string): Promise<PaymasterBalance[]> {
  const chains = Object.values(CHAINS) as ChainConfig[];
  const results = await Promise.allSettled(
    chains.map((c) => fetchBalance(c, userAddress))
  );
  return results.map((r, i) =>
    r.status === "fulfilled"
      ? r.value
      : { chain: chains[i], paymasterAddress: "", balance: 0n, gasRate: 0n, paused: false, isDeployed: isPaymasterDeployed(chains[i].id) }
  );
}

export interface SmartAccountPaymasterBalance {
  balance: bigint;
  locked: bigint;
  available: bigint;
}

/**
 * Fetch a smart account's Paymaster balance on one chain.
 * Returns { balance, locked, available } where available = balance - locked.
 * This mirrors exactly what validatePaymasterUserOp checks.
 */
export async function fetchSmartAccountPaymasterBalance(
  chain: ChainConfig,
  smartAccountAddr: string
): Promise<SmartAccountPaymasterBalance> {
  const addr = PAYMASTER_ADDRESSES[chain.id];
  if (!isPaymasterDeployed(chain.id)) {
    return { balance: 0n, locked: 0n, available: 0n };
  }
  const rpcUrl  = chain.rpcUrl ?? getChainRpc(chain.id);
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const contract = new ethers.Contract(addr, PAYMASTER_ABI, provider);

  const [balance, locked] = await Promise.all([
    contract.balances(smartAccountAddr) as Promise<bigint>,
    contract.locked(smartAccountAddr)   as Promise<bigint>,
  ]);
  const available = balance > locked ? balance - locked : 0n;
  return { balance, locked, available };
}

/** Fetch the user's wallet USDC balance on a specific chain. */
export async function fetchWalletBalance(chain: ChainConfig, userAddress: string): Promise<bigint> {
  const rpcUrl  = getChainRpc(chain.id);
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const usdc     = new ethers.Contract(chain.usdcAddress, USDC_ABI, provider);
  return usdc.balanceOf(userAddress) as Promise<bigint>;
}

/** Deposit USDC into the paymaster on the given chain. */
export async function depositToPaymaster(
  chain: ChainConfig,
  amount: bigint,
  setStatus: (s: PaymasterStatus) => void
): Promise<string> {
  const paymasterAddr = PAYMASTER_ADDRESSES[chain.id];
  if (!paymasterAddr) throw new Error("Paymaster not deployed on this chain");

  setStatus({ step: "switching", message: `Switching to ${chain.name}…` });
  await switchToChain(chain);
  const provider = await getProvider();

  const signer  = await provider.getSigner();
  const usdc    = new ethers.Contract(chain.usdcAddress, USDC_ABI, signer);
  const paymaster = new ethers.Contract(paymasterAddr, PAYMASTER_ABI, signer);

  const allowance = await usdc.allowance(await signer.getAddress(), paymasterAddr) as bigint;
  if (allowance < amount) {
    setStatus({ step: "approving", message: "Approve USDC spend in wallet…" });
    const approveTx = await usdc.approve(paymasterAddr, amount);
    await approveTx.wait();
  }

  setStatus({ step: "depositing", message: "Confirm deposit in wallet…" });
  const tx = await paymaster.deposit(amount);
  await tx.wait();

  setStatus({ step: "done", message: "Deposited!", txHash: tx.hash });
  return tx.hash as string;
}

/** Withdraw USDC from the paymaster on the given chain. */
export async function withdrawFromPaymaster(
  chain: ChainConfig,
  amount: bigint,
  setStatus: (s: PaymasterStatus) => void
): Promise<string> {
  const paymasterAddr = PAYMASTER_ADDRESSES[chain.id];
  if (!paymasterAddr) throw new Error("Paymaster not deployed on this chain");

  setStatus({ step: "switching", message: `Switching to ${chain.name}…` });
  await switchToChain(chain);
  const provider = await getProvider();

  const signer    = await provider.getSigner();
  const paymaster = new ethers.Contract(paymasterAddr, PAYMASTER_ABI, signer);

  setStatus({ step: "withdrawing", message: "Confirm withdrawal in wallet…" });
  const tx = await paymaster.withdraw(amount);
  await tx.wait();

  setStatus({ step: "done", message: "Withdrawn!", txHash: tx.hash });
  return tx.hash as string;
}

/** Format a raw USDC bigint (6 decimals) to a human-readable string. */
export function fmtUsdc(raw: bigint): string {
  const n = Number(raw) / 1e6;
  return n < 0.01 ? n.toFixed(6) : n.toFixed(2);
}

export { friendlyError };
