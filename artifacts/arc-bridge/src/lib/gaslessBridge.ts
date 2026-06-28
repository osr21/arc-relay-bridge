/**
 * Gasless bridge using ERC-4337 + our USDC Paymaster.
 *
 * The smart account holds USDC in its own on-chain wallet and burns it directly
 * via the CCTP TokenMessenger — no native tokens (ETH / AVAX) needed at any step.
 *
 * UserOp batch (2 calls):
 *   1. USDC.approve(tokenMessenger, burnAmount)   — allow burn
 *   2. TokenMessenger.depositForBurn(...)          — burn → CCTP
 *
 * Gas is paid from the smart account's USDC deposit in our Paymaster.
 *
 * Supported source chains: Ethereum Sepolia, Base Sepolia, Avalanche Fuji.
 * Arc Testnet is not supported as a source chain (native USDC gas works there).
 *
 * Setup required (one-time per chain):
 *   • Fund the smart account address with USDC for the bridge amount.
 *   • Deposit a small amount of USDC into the Paymaster for gas (≈1.8 USDC / bridge).
 *     The Paymaster page → Gasless Bridge Setup runs this deposit as a Pimlico-sponsored
 *     UserOp so NO native tokens are needed for the deposit either.
 */

import {
  createPublicClient,
  http,
  encodeFunctionData,
  erc20Abi,
  parseAbi,
  parseUnits,
  type Chain,
  type Hex,
  type Address,
  type PublicClient,
} from "viem";
import { sepolia, baseSepolia, avalancheFuji } from "viem/chains";
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
  "function paused() view returns (bool)",
  "function MAX_DEDUCTION_PER_TX() view returns (uint256)",
]);

const USDC_READ_ABI = parseAbi([
  "function balanceOf(address) view returns (uint256)",
]);

/** Hard cap the Paymaster enforces per UserOp (6 dec USDC). */
const PAYMASTER_MAX_DEDUCTION = 10_000_000n; // 10 USDC

/**
 * Conservative total gas estimate for a 2-call batched UserOp:
 * approve ~50k + depositForBurn ~200k + overhead ~200k = ~450k,
 * +33% buffer = 600k.
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

// ── Main exports ───────────────────────────────────────────────────────────────

/**
 * Execute the gasless bridge flow:
 *  1. Pre-flight: verify smart account has enough USDC to burn AND enough
 *     Paymaster balance to cover gas.
 *  2. Build a 2-call batched UserOp:
 *       approve(tokenMessenger, burnAmount)
 *       depositForBurn(...)
 *  3. Pay gas via USDC Paymaster — no native tokens needed.
 *  4. Wait for UserOp inclusion, parse messageBytes.
 *  5. Resume via resumeBridge (attestation + EOA mint on destination chain).
 *
 * USDC for the burn comes from the smart account's own on-chain balance.
 * Gas comes from the smart account's USDC deposit in the Paymaster.
 * No ETH / AVAX / native tokens required at any point.
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

  // Validate recipient address before any contract encoding.
  // toBytes32Address does left-padding only — an invalid address (wrong length, bad chars)
  // would produce malformed calldata and a silent on-chain revert.
  if (!/^0x[0-9a-fA-F]{40}$/.test(recipient)) {
    throw new Error(`Invalid recipient address: ${recipient}`);
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
    message: "Preparing smart account — checking balances…",
  });

  const paymasterAddr = (PAYMASTER_ADDRESSES as Record<number, string | undefined>)[fromChain.id];
  if (!paymasterAddr) throw new Error(`No Paymaster deployed for ${fromChain.name}.`);

  const smartAccountAddr = await getSmartAccountAddress(fromChain.id);

  const preflight: PublicClient = createPublicClient({
    chain: (CHAIN_VIEM_MAP as Record<number, Chain>)[fromChain.id],
    transport: http(CHAIN_RPC[fromChain.id]),
  });

  // ── Check smart account USDC balance (for the burn) ───────────────────────
  const smartAccountUsdc = await preflight.readContract({
    address: fromChain.usdcAddress as Address,
    abi: USDC_READ_ABI,
    functionName: "balanceOf",
    args: [smartAccountAddr],
  });

  if (smartAccountUsdc < burnUnits) {
    const have = (Number(smartAccountUsdc) / 1e6).toFixed(6);
    const need = (Number(burnUnits) / 1e6).toFixed(6);
    throw new Error(
      `Insufficient USDC in your smart account.\n` +
        `Have: ${have} USDC — need ${need} USDC to bridge.\n` +
        `Send USDC from your MetaMask wallet to your SimpleAccount address ` +
        `on ${fromChain.name} first.`
    );
  }

  // ── Check Paymaster balance (gas) ─────────────────────────────────────────
  const [paymasterBalance, lockedAmount, gasRate, paymasterPaused] = await Promise.all([
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
    preflight.readContract({
      address: paymasterAddr as Address,
      abi: PAYMASTER_BALANCES_ABI,
      functionName: "paused",
    }),
  ]);

  // Fail fast if the Paymaster is paused — validatePaymasterUserOp will revert
  // on-chain and waste the user's time regardless of their balance.
  if (paymasterPaused) {
    throw new Error(
      `The Paymaster is currently paused on ${fromChain.name}.\n` +
      `Gasless bridging is temporarily unavailable. Try again later or use the standard bridge (ETH/AVAX for gas).`
    );
  }

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

  // ── Build and submit the UserOp ───────────────────────────────────────────

  onStatus({
    step: "approving",
    message: "Connecting to bundler…",
  });

  const client = await createBridgeClient(fromChain.id);

  // Call 1: approve TokenMessenger to spend the smart account's USDC
  const approveData = encodeFunctionData({
    abi: erc20Abi,
    functionName: "approve",
    args: [fromChain.tokenMessenger as Address, burnUnits],
  });

  // Call 2: burn via CCTP V2
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
    message: "Sign the UserOperation in your wallet to approve and burn USDC…",
  });

  const userOpHash = await client.sendUserOperation({
    calls: [
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

  if (!userOpReceipt.success) {
    throw new Error(
      "Gasless bridge UserOperation failed — the approve or depositForBurn call reverted on-chain. " +
      "No USDC was burned. Check your smart account USDC balance and try again."
    );
  }

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
 * smart account address (one regular MetaMask tx — costs a small amount of native gas).
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
