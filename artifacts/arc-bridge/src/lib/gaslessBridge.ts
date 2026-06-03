/**
 * Gasless bridge using ERC-4337 + our USDC Paymaster.
 *
 * USDC for the burn comes from the user's MetaMask EOA — the smart account
 * pulls it via transferFrom as the first call in the batched UserOperation.
 * A one-time EOA approve(smartAccount, MaxUint256) is required; after that
 * every bridge is fully gasless with no ETH and no pre-funded smart account.
 *
 * UserOp batch (4 calls):
 *   1. USDC.transferFrom(EOA, smartAccount, burnAmount)   — pull from wallet
 *   2. USDC.approve(tokenMessenger, burnAmount)           — allow burn
 *   3. TokenMessenger.depositForBurn(...)                 — burn → CCTP
 *
 * Gas is paid from the smart account's USDC deposit in our Paymaster — no
 * native tokens ever needed.
 *
 * Supported source chains: Ethereum Sepolia, Base Sepolia, Avalanche Fuji.
 * Arc Testnet is not supported as a source chain (native USDC gas works there).
 */

import {
  createPublicClient,
  http,
  encodeFunctionData,
  erc20Abi,
  parseAbi,
  parseUnits,
  maxUint256,
  type Chain,
  type Hex,
  type Address,
  type PublicClient,
} from "viem";
import { sepolia, baseSepolia, avalancheFuji } from "viem/chains";
import { ethers } from "ethers";
import type { ChainConfig } from "./chains";
import type { BridgeStatus } from "./bridge";
import { resumeBridge } from "./bridge";
import {
  createBridgeClient,
  createSponsoredClient,
  getSmartAccountAddress,
  isAASupported,
} from "./aa";
import { PAYMASTER_ADDRESSES } from "./paymaster";

const PAYMASTER_BALANCES_ABI = parseAbi([
  "function balances(address user) view returns (uint256)",
  "function locked(address user) view returns (uint256)",
  "function gasRate() view returns (uint256)",
  "function MAX_DEDUCTION_PER_TX() view returns (uint256)",
]);

const USDC_READ_ABI = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
]);

/** Hard cap the Paymaster enforces per UserOp (6 dec USDC). */
const PAYMASTER_MAX_DEDUCTION = 10_000_000n; // 10 USDC

/**
 * Conservative total gas estimate for a 3-call batched UserOp:
 * transferFrom ~30k + approve ~50k + depositForBurn ~200k + overhead ~200k = ~480k,
 * +25% buffer = 600k.
 */
const ESTIMATED_USEROP_GAS = 600_000n;

// ── ABIs ──────────────────────────────────────────────────────────────────────

const DEPOSIT_FOR_BURN_V2 = parseAbi([
  "function depositForBurn(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold) returns (uint64 nonce)",
]);

const PAYMASTER_DEPOSIT_ABI = parseAbi(["function deposit(uint256 amount)"]);

// ── Constants ─────────────────────────────────────────────────────────────────

/** keccak256("MessageSent(bytes)") — identical on all CCTP chains */
const MSG_SENT_TOPIC =
  "0x8c5261668696ce22758910d05bab8f186d6eb247ceac2af2e82c7dc17669b036" as Hex;

const ZERO_BYTES32 = `0x${"0".repeat(64)}` as Hex;

const CHAIN_VIEM_MAP: Record<number, Chain> = {
  11155111: sepolia,
  84532: baseSepolia,
  43113: avalancheFuji,
};

const CHAIN_RPC: Record<number, string> = {
  11155111: "https://ethereum-sepolia-rpc.publicnode.com",
  84532: "https://sepolia.base.org",
  43113: "https://api.avax-test.network/ext/bc/C/rpc",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Convert a 20-byte address to a left-padded bytes32 for CCTP mintRecipient. */
function toBytes32Address(address: string): Hex {
  const addr = address.toLowerCase().replace(/^0x/, "");
  return `0x${"0".repeat(24)}${addr}` as Hex;
}

/** Parse the ABI-encoded `bytes message` from a MessageSent(bytes) log data field. */
function parseMessageSentFromLogs(
  logs: readonly { topics: readonly Hex[]; data: Hex }[]
): Hex | undefined {
  for (const log of logs) {
    if (log.topics[0]?.toLowerCase() !== MSG_SENT_TOPIC.toLowerCase()) continue;
    const raw = log.data.slice(2);
    if (raw.length < 128) continue;
    const byteLen = parseInt(raw.slice(64, 128), 16);
    const messageHex = raw.slice(128, 128 + byteLen * 2);
    if (messageHex.length > 0) return `0x${messageHex}` as Hex;
  }
  return undefined;
}

/** Get the connected EOA address from MetaMask. */
async function getEoaAddress(): Promise<Address> {
  if (!window.ethereum) throw new Error("No wallet detected");
  const accounts = await (window.ethereum as { request: (args: { method: string }) => Promise<string[]> })
    .request({ method: "eth_accounts" });
  if (!accounts[0]) throw new Error("No wallet connected");
  return accounts[0] as Address;
}

/**
 * Ensure the EOA has approved the smart account to spend at least `amount` USDC.
 * If not, submits a regular MetaMask approve(smartAccount, MaxUint256) tx.
 * This is a one-time per-chain setup — subsequent bridges reuse the approval.
 */
async function ensureEoaApproval(
  chain: ChainConfig,
  eoaAddress: Address,
  smartAccountAddr: Address,
  amount: bigint,
  onStatus: (s: BridgeStatus) => void
): Promise<void> {
  const provider = new ethers.BrowserProvider(window.ethereum as ethers.Eip1193Provider);

  const usdc = new ethers.Contract(
    chain.usdcAddress,
    [
      "function allowance(address owner, address spender) view returns (uint256)",
      "function approve(address spender, uint256 amount) returns (bool)",
    ],
    provider
  );

  const allowance = (await usdc.allowance(eoaAddress, smartAccountAddr)) as bigint;
  if (allowance >= amount) return;

  onStatus({
    step: "approving",
    message:
      "One-time setup: approve your wallet to let the smart account pull USDC for the burn…",
  });

  const signer = await provider.getSigner();
  const usdcSigner = usdc.connect(signer) as ethers.Contract;
  // Approve unlimited so this never needs to be repeated.
  const tx = await usdcSigner.approve(smartAccountAddr, ethers.MaxUint256);
  await tx.wait();
}

// ── Main exports ───────────────────────────────────────────────────────────────

/**
 * Execute the gasless bridge flow:
 *  0. (One-time) EOA approves smart account to spend USDC if not already done.
 *  1. Build a 3-call batched UserOp:
 *       transferFrom(EOA → smartAccount, burnAmount)
 *       approve(tokenMessenger, burnAmount)
 *       depositForBurn(...)
 *  2. Pay gas via USDC Paymaster — no ETH needed.
 *  3. Wait for UserOp inclusion, parse messageBytes.
 *  4. Resume via resumeBridge (attestation + EOA mint on destination chain).
 *
 * USDC comes from the user's MetaMask wallet. Gas comes from the smart account's
 * Paymaster deposit. After the one-time EOA approval, every bridge is fully gasless.
 */
export async function executeBridgeGasless(
  fromChain: ChainConfig,
  toChain: ChainConfig,
  amount: string,
  recipient: string,
  onStatus: (s: BridgeStatus) => void
): Promise<void> {
  if (!isAASupported(fromChain.id)) {
    throw new Error(
      `Gasless bridging requires Ethereum Sepolia, Base Sepolia, or Avalanche Fuji as source chain.`
    );
  }

  const trimmedAmount = amount.trim();
  if (/e/i.test(trimmedAmount)) throw new Error("Please enter a plain decimal number (e.g. 1.50).");
  const amountFloat = parseFloat(trimmedAmount);
  if (isNaN(amountFloat) || amountFloat <= 0) throw new Error("Invalid amount.");
  const parts = trimmedAmount.split(".");
  if (parts[1] && parts[1].length > 6) throw new Error("Amount cannot have more than 6 decimal places.");
  let burnUnits: bigint;
  try {
    burnUnits = parseUnits(trimmedAmount as `${number}`, 6);
  } catch {
    throw new Error("Invalid amount entered.");
  }

  const mintRecipient32 = toBytes32Address(recipient);
  const finalityThreshold = fromChain.minFinalityThreshold ?? 1000;

  onStatus({
    step: "approving",
    message: "Preparing smart account — checking Paymaster balance…",
  });

  const paymasterAddr = (PAYMASTER_ADDRESSES as Record<number, string | undefined>)[fromChain.id];
  if (!paymasterAddr) throw new Error(`No Paymaster deployed for ${fromChain.name}.`);

  const smartAccountAddr = await getSmartAccountAddress(fromChain.id);
  const eoaAddress       = await getEoaAddress();

  const preflight: PublicClient = createPublicClient({
    chain: (CHAIN_VIEM_MAP as Record<number, Chain>)[fromChain.id],
    transport: http(CHAIN_RPC[fromChain.id]),
  });

  // ── Check EOA USDC balance ────────────────────────────────────────────────
  const eoaUsdcBalance = await preflight.readContract({
    address: fromChain.usdcAddress as Address,
    abi: USDC_READ_ABI,
    functionName: "balanceOf",
    args: [eoaAddress],
  });

  if (eoaUsdcBalance < burnUnits) {
    const have = (Number(eoaUsdcBalance) / 1e6).toFixed(6);
    const need = (Number(burnUnits) / 1e6).toFixed(6);
    throw new Error(
      `Insufficient USDC in your wallet.\nHave: ${have} USDC — need ${need} USDC.`
    );
  }

  // ── Check Paymaster balance (gas) ─────────────────────────────────────────
  const [paymasterBalance, lockedAmount, gasRate] = await Promise.all([
    preflight.readContract({
      address: paymasterAddr as Address,
      abi: PAYMASTER_BALANCES_ABI,
      functionName: "balances",
      args: [smartAccountAddr],
    }),
    preflight.readContract({
      address: paymasterAddr as Address,
      abi: PAYMASTER_BALANCES_ABI,
      functionName: "locked",
      args: [smartAccountAddr],
    }),
    preflight.readContract({
      address: paymasterAddr as Address,
      abi: PAYMASTER_BALANCES_ABI,
      functionName: "gasRate",
    }),
  ]);

  const available = paymasterBalance > lockedAmount ? paymasterBalance - lockedAmount : 0n;

  let minRequired: bigint;
  if (gasRate === 0n) {
    minRequired = PAYMASTER_MAX_DEDUCTION;
  } else {
    const estimated = ESTIMATED_USEROP_GAS * gasRate;
    const buffered  = (estimated * 150n) / 100n;
    minRequired     = buffered < PAYMASTER_MAX_DEDUCTION ? buffered : PAYMASTER_MAX_DEDUCTION;
  }

  if (available < minRequired) {
    const have = (Number(available) / 1e6).toFixed(2);
    const need = (Number(minRequired) / 1e6).toFixed(2);
    const lockedNote =
      lockedAmount > 0n
        ? ` (${(Number(paymasterBalance) / 1e6).toFixed(2)} deposited, ${(Number(lockedAmount) / 1e6).toFixed(2)} reserved by a pending op)`
        : "";
    throw new Error(
      `Insufficient Paymaster balance for your smart account.\n` +
        `Available: ${have} USDC${lockedNote} — need at least ${need} USDC to cover gas.\n` +
        `Go to the Paymaster page → Gasless Bridge Setup and deposit USDC for gas.`
    );
  }

  // ── One-time EOA → smart account USDC approval ───────────────────────────
  // This allows the smart account to pull USDC from the EOA during the UserOp.
  // After this runs once per chain the approval is reused for all future bridges.
  await ensureEoaApproval(
    fromChain,
    eoaAddress,
    smartAccountAddr as Address,
    burnUnits,
    onStatus
  );

  // ── Build and submit the UserOp ───────────────────────────────────────────

  onStatus({
    step: "approving",
    message: "Connecting to bundler…",
  });

  const client = await createBridgeClient(fromChain.id);

  // Call 1: pull USDC from EOA into the smart account
  const transferFromData = encodeFunctionData({
    abi: erc20Abi,
    functionName: "transferFrom",
    args: [eoaAddress, smartAccountAddr as Address, burnUnits],
  });

  // Call 2: approve TokenMessenger to spend the pulled USDC
  const approveData = encodeFunctionData({
    abi: erc20Abi,
    functionName: "approve",
    args: [fromChain.tokenMessenger as Address, burnUnits],
  });

  // Call 3: burn via CCTP V2
  const burnData = encodeFunctionData({
    abi: DEPOSIT_FOR_BURN_V2,
    functionName: "depositForBurn",
    args: [
      burnUnits,
      toChain.cctpDomain,
      mintRecipient32,
      fromChain.usdcAddress as Address,
      ZERO_BYTES32,
      0n,
      finalityThreshold,
    ],
  });

  onStatus({
    step: "burning",
    message: "Sign the UserOperation in your wallet to pull USDC from your wallet and burn…",
  });

  const userOpHash = await client.sendUserOperation({
    calls: [
      { to: fromChain.usdcAddress as Address, data: transferFromData },
      { to: fromChain.usdcAddress as Address, data: approveData },
      { to: fromChain.tokenMessenger as Address, data: burnData },
    ],
  });

  onStatus({
    step: "burning",
    message: "UserOperation submitted — waiting for bundler to include it…",
  });

  const userOpReceipt = await client.waitForUserOperationReceipt({
    hash: userOpHash,
  });

  const burnTxHash = userOpReceipt.receipt.transactionHash;
  const logs       = userOpReceipt.receipt.logs as unknown as {
    topics: readonly Hex[];
    data: Hex;
  }[];
  const messageBytes = parseMessageSentFromLogs(logs);

  await resumeBridge(fromChain, toChain, burnTxHash, messageBytes, undefined, onStatus);
}

/**
 * Bootstrap: deposit USDC from the smart account into our Paymaster.
 * Pimlico sponsors this UserOp (free on testnet), so no ETH is needed here.
 *
 * Pre-condition: the smart account must hold USDC.
 * To fund the smart account, send USDC from your MetaMask EOA to the
 * smart account address (one regular MetaMask tx — costs a small amount of ETH).
 */
export async function depositToPaymasterGasless(
  chain: ChainConfig,
  amountUnits: bigint,
  onStep: (step: string, message: string, txHash?: string) => void
): Promise<string> {
  const paymasterAddr = (PAYMASTER_ADDRESSES as Record<number, string | undefined>)[chain.id];
  if (!paymasterAddr) throw new Error(`No Paymaster deployed for ${chain.name}.`);
  if (!isAASupported(chain.id)) throw new Error(`AA not supported on ${chain.name}.`);

  onStep("approving", "Preparing Pimlico-sponsored UserOperation…");

  const client = await createSponsoredClient(chain.id);

  const approveData = encodeFunctionData({
    abi: erc20Abi,
    functionName: "approve",
    args: [paymasterAddr as Address, amountUnits],
  });

  const depositData = encodeFunctionData({
    abi: PAYMASTER_DEPOSIT_ABI,
    functionName: "deposit",
    args: [amountUnits],
  });

  onStep("depositing", "Sign the sponsored UserOperation in your wallet (Pimlico pays gas)…");

  const userOpHash = await client.sendUserOperation({
    calls: [
      { to: chain.usdcAddress as Address, data: approveData },
      { to: paymasterAddr as Address, data: depositData },
    ],
  });

  onStep("depositing", "UserOperation submitted — waiting for confirmation…");

  const receipt  = await client.waitForUserOperationReceipt({ hash: userOpHash });
  const txHash   = receipt.receipt.transactionHash;

  onStep("done", "Deposit complete! Your smart account gas balance is funded.", txHash);
  return txHash;
}

export { getSmartAccountAddress } from "./aa";
export { isAASupported } from "./aa";

export function createChainPublicClient(chainId: number) {
  const chain = CHAIN_VIEM_MAP[chainId];
  const rpc   = CHAIN_RPC[chainId];
  if (!chain || !rpc) throw new Error(`No public client for chain ${chainId}`);
  return createPublicClient({ chain, transport: http(rpc) });
}
