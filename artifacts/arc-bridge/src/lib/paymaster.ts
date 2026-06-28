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
  5042002:  "0xEE39e1690F1bE07e8a68813f57cE3142197CECf6", // Arc Testnet      (v6-hardened)
  11155111: "0xe7ED22eF9Af9CAd98B048979dbd726e89dd0D417", // Ethereum Sepolia  (v6-hardened)
  84532:    "0x5f309aE9A9A364Ae18af77b7733bB9C43A032A4A", // Base Sepolia      (v6-hardened)
  43113:    "0x0D3B7bd972F4Cc3CDAB62E1cFafcA79F8d7167f5", // Avalanche Fuji    (v6-hardened)
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

/** ERC-4337 v0.7 EntryPoint — same address on all EVM chains. */
const ENTRY_POINT_ADDRESS = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";
const ENTRY_POINT_ABI = [
  "function balanceOf(address account) view returns (uint256)",
];

export interface SmartAccountPaymasterBalance {
  balance: bigint;
  locked: bigint;
  available: bigint;
  paused: boolean;
  gasRate: bigint;
  /** Paymaster's native-token deposit in the EntryPoint (wei). Must be > 0 for UserOps to be accepted by the bundler. */
  entryPointDeposit: bigint;
}

/**
 * Fetch a smart account's Paymaster balance on one chain.
 * Returns { balance, locked, available, paused, gasRate, entryPointDeposit }.
 * `available = balance - locked` mirrors exactly what validatePaymasterUserOp checks.
 * `paused = true` means validatePaymasterUserOp will revert regardless of balance.
 * `entryPointDeposit` is the Paymaster's native-token reserve in the EntryPoint —
 *  if this is too low, the bundler will reject the UserOp before even calling the Paymaster.
 */
export async function fetchSmartAccountPaymasterBalance(
  chain: ChainConfig,
  smartAccountAddr: string
): Promise<SmartAccountPaymasterBalance> {
  const addr = PAYMASTER_ADDRESSES[chain.id];
  if (!isPaymasterDeployed(chain.id)) {
    return { balance: 0n, locked: 0n, available: 0n, paused: false, gasRate: 0n, entryPointDeposit: 0n };
  }
  const rpcUrl  = chain.rpcUrl ?? getChainRpc(chain.id);
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const contract = new ethers.Contract(addr, PAYMASTER_ABI, provider);
  const entryPointContract = new ethers.Contract(ENTRY_POINT_ADDRESS, ENTRY_POINT_ABI, provider);

  const [balance, locked, paused, gasRate, entryPointDeposit] = await Promise.all([
    contract.balances(smartAccountAddr) as Promise<bigint>,
    contract.locked(smartAccountAddr)   as Promise<bigint>,
    contract.paused()                   as Promise<boolean>,
    contract.gasRate()                  as Promise<bigint>,
    entryPointContract.balanceOf(addr)  as Promise<bigint>,
  ]);
  const available = balance > locked ? balance - locked : 0n;
  return { balance, locked, available, paused, gasRate, entryPointDeposit };
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
