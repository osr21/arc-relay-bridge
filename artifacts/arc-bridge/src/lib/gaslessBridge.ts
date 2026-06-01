/**
 * Gasless bridge using ERC-4337 + our USDC Paymaster.
 *
 * Source chain burn (approve + depositForBurn) is sent as a batched UserOperation.
 * Gas is paid from the smart account's USDC deposit in our Paymaster — no ETH needed.
 *
 * After the burn is confirmed on-chain, attestation + destination-chain mint follow
 * the standard resumeBridge flow (EOA tx on the destination chain).
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
  type Chain,
  type Hex,
  type Address,
} from "viem";
import { sepolia, baseSepolia, avalancheFuji } from "viem/chains";
import type { ChainConfig } from "./chains";
import type { BridgeStatus } from "./bridge";
import { resumeBridge } from "./bridge";
import {
  createBridgeClient,
  createSponsoredClient,
  isAASupported,
} from "./aa";
import { PAYMASTER_ADDRESSES } from "./paymaster";

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
    // data = abi.encode(bytes message):
    //   [0..31]   offset = 32
    //   [32..63]  byte length
    //   [64..]    message data (padded to 32-byte boundary)
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
 *  1. Send a batched UserOp (approve + depositForBurn) paying gas via our USDC Paymaster.
 *  2. Wait for the UserOp to be included on-chain.
 *  3. Parse messageBytes from the transaction logs.
 *  4. Resume via resumeBridge (attestation + EOA mint on destination chain).
 *
 * Requires the smart account to have a non-zero USDC balance in the Paymaster.
 * To bootstrap: call depositToPaymasterGasless() first (sponsored by Pimlico, free on testnet).
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

  const amountFloat = parseFloat(amount.trim());
  if (isNaN(amountFloat) || amountFloat <= 0) throw new Error("Invalid amount.");
  const burnUnits = BigInt(Math.round(amountFloat * 1_000_000));

  const mintRecipient32 = toBytes32Address(recipient);
  const finalityThreshold = fromChain.minFinalityThreshold ?? 1000;

  onStatus({
    step: "approving",
    message: "Preparing smart account — connecting to bundler…",
  });

  const client = await createBridgeClient(fromChain.id);

  const approveData = encodeFunctionData({
    abi: erc20Abi,
    functionName: "approve",
    args: [fromChain.tokenMessenger as Address, burnUnits],
  });

  const burnData = encodeFunctionData({
    abi: DEPOSIT_FOR_BURN_V2,
    functionName: "depositForBurn",
    args: [
      burnUnits,
      toChain.cctpDomain,         // uint32 → number
      mintRecipient32,             // bytes32
      fromChain.usdcAddress as Address, // address
      ZERO_BYTES32,                // destinationCaller = 0 (anyone may relay)
      0n,                          // maxFee = 0
      finalityThreshold,           // uint32 → number
    ],
  });

  onStatus({
    step: "burning",
    message: "Sign the UserOperation in your wallet to approve + burn USDC…",
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

  const burnTxHash = userOpReceipt.receipt.transactionHash;
  const logs = userOpReceipt.receipt.logs as unknown as {
    topics: readonly Hex[];
    data: Hex;
  }[];
  const messageBytes = parseMessageSentFromLogs(logs);

  // Hand off to the existing resumeBridge for attestation + chain switch + mint.
  await resumeBridge(
    fromChain,
    toChain,
    burnTxHash,
    messageBytes,
    undefined,
    onStatus
  );
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
  const paymasterAddr = (PAYMASTER_ADDRESSES as Record<number, string | undefined>)[
    chain.id
  ];
  if (!paymasterAddr) throw new Error(`No Paymaster deployed for ${chain.name}.`);
  if (!isAASupported(chain.id))
    throw new Error(`AA not supported on ${chain.name}.`);

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

  onStep(
    "depositing",
    "Sign the sponsored UserOperation in your wallet (Pimlico pays gas)…"
  );

  const userOpHash = await client.sendUserOperation({
    calls: [
      { to: chain.usdcAddress as Address, data: approveData },
      { to: paymasterAddr as Address, data: depositData },
    ],
  });

  onStep("depositing", "UserOperation submitted — waiting for confirmation…");

  const receipt = await client.waitForUserOperationReceipt({ hash: userOpHash });
  const txHash = receipt.receipt.transactionHash;

  onStep("done", "Deposit complete! Your smart account gas balance is funded.", txHash);
  return txHash;
}

/**
 * Derive the counterfactual SimpleAccount address for the connected MetaMask
 * EOA on a given AA-supported chain (reads from chain, no tx needed).
 */
export { getSmartAccountAddress } from "./aa";

/** Check if a chain supports gasless bridging (ERC-4337 source). */
export { isAASupported } from "./aa";

/** Create a viem PublicClient for waiting on transaction receipts. */
export function createChainPublicClient(chainId: number) {
  const chain = CHAIN_VIEM_MAP[chainId];
  const rpc = CHAIN_RPC[chainId];
  if (!chain || !rpc) throw new Error(`No public client for chain ${chainId}`);
  return createPublicClient({ chain, transport: http(rpc) });
}
