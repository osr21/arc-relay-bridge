import { ethers } from "ethers";
import {
  ChainConfig,
  USDC_ABI,
  TOKEN_MESSENGER_V2_ABI,
  MESSAGE_TRANSMITTER_ABI,
} from "./chains";
import { formatUsdc } from "./config";
import { assertBackendEnvironment, assertFeatureAvailable } from "./network";

export type BridgeStep =
  | "idle"
  | "approving"
  | "collecting"
  | "burning"
  | "attesting"
  | "minting"
  | "done"
  | "error";

export type ActiveStep = "approving" | "collecting" | "burning" | "attesting" | "minting";
export const ARC_MINT_GAS_RESERVE = 20_000_000_000_000_000n;
export const BASE_MINT_GAS_RESERVE = 100_000_000_000_000n;
const APPROVE_GAS_LIMIT = 100_000n;
const CCTP_WRITE_GAS_LIMIT = 600_000n;

export function hasArcMintGasReserve(balance: bigint, reserve = ARC_MINT_GAS_RESERVE): boolean {
  return balance >= reserve;
}

export function hasBaseMintGasReserve(balance: bigint, reserve = BASE_MINT_GAS_RESERVE): boolean {
  return balance >= reserve;
}

export interface BridgeStatus {
  step: BridgeStep;
  message: string;
  txHash?: string;
  feeTxHash?: string;
  burnTxHash?: string;
  mintTxHash?: string;
  messageBytes?: string;
  sourceMessageHash?: string;
  sourceLogIndex?: number;
  error?: string;
  failedAtStep?: ActiveStep;
}

declare global {
  interface Window {
    ethereum?: ethers.Eip1193Provider & {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
      on?: (event: string, handler: (...args: unknown[]) => void) => void;
      removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
    };
  }
}

export async function getProvider(): Promise<ethers.BrowserProvider> {
  if (!window.ethereum) {
    throw new Error("No wallet detected. Please install MetaMask.");
  }
  return new ethers.BrowserProvider(window.ethereum);
}

export async function connectWallet(): Promise<string> {
  const provider = await getProvider();
  const accounts = await provider.send("eth_requestAccounts", []);
  const list = accounts as string[];
  if (!list || list.length === 0) {
    throw new Error("No accounts returned. Please unlock your wallet and try again.");
  }
  return list[0];
}

/** Prompt MetaMask to add the chain's USDC token to the wallet token list. */
export async function addUsdcToWallet(chain: ChainConfig): Promise<void> {
  if (!window.ethereum) throw new Error("No wallet detected.");
  await window.ethereum.request({
    method: "wallet_watchAsset",
    params: {
      type: "ERC20",
      options: {
        address: chain.usdcAddress,
        symbol: "USDC",
        decimals: 6,
      },
    } as unknown as unknown[],
  });
}

export async function getWalletChainId(): Promise<number> {
  if (!window.ethereum) throw new Error("No wallet detected.");
  const hexId = (await window.ethereum.request({ method: "eth_chainId" })) as string;
  return parseInt(hexId, 16);
}

export async function switchToChain(chain: ChainConfig): Promise<void> {
  if (!window.ethereum) throw new Error("No wallet detected.");

  const explorerUrls = chain.explorerUrl ? [chain.explorerUrl] : [];

  const addChain = () =>
    window.ethereum!.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: chain.hexId,
          chainName: chain.name,
          nativeCurrency: chain.nativeCurrency,
          rpcUrls: [chain.rpcUrl],
          ...(explorerUrls.length > 0 && { blockExplorerUrls: explorerUrls }),
        },
      ],
    });

  try {
    // wallet_switchEthereumChain works for built-in chains (Sepolia, Base, Fuji).
    // For custom networks like Arc Testnet it may fail with 4902, or with a non-standard
    // error, or silently return without actually switching. See arc-node#89.
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: chain.hexId }],
    });

    // MetaMask race: eth_chainId can still report the old chain for ~200-500 ms after
    // wallet_switchEthereumChain resolves. Without this delay, the verification below
    // sees the pre-switch chainId and triggers wallet_addEthereumChain unnecessarily —
    // showing the user a second "Add / Switch Arc Testnet" popup that they then dismiss,
    // breaking the flow. 400 ms is enough for MetaMask to update its internal state.
    await new Promise(r => setTimeout(r, 400));

    // Verify the switch actually took effect — Arc Testnet can return success without switching.
    const current = await getWalletChainId();
    if (current !== chain.id) {
      await addChain();
    }
  } catch (err: unknown) {
    const code = (err as { code?: number })?.code;
    if (code === 4001) throw err; // User rejected — propagate immediately
    // Any other error (4902 = unknown chain, or Arc's non-standard failures):
    // fall through to wallet_addEthereumChain, which adds the network if missing
    // and switches to it if already present. See arc-node#89.
    await addChain();
  }
}

/** Normalise any thrown error into a clean, user-facing message. */
export function friendlyError(err: unknown): string {
  const msg = (err as Error)?.message ?? String(err);
  const code = (err as { code?: unknown })?.code;

  // MetaMask / EIP-1193 user rejection
  if (
    msg.includes("user rejected") ||
    msg.includes("User denied") ||
    msg.includes("ACTION_REJECTED") ||
    code === 4001 ||
    code === "ACTION_REJECTED"
  ) {
    return "Transaction cancelled — you rejected the request in your wallet.";
  }

  // ERC-4337 Paymaster validation failure — pre-flight or on-chain revert
  if (
    msg.includes("validatePaymasterUserOp") ||
    (msg.includes("paymaster") && msg.includes("revert")) ||
    msg.includes("Insufficient Paymaster balance") ||
    msg.includes("Paymaster is paused") ||
    msg.includes("Paymaster: paused") ||
    // Pimlico bundler: insufficient Paymaster ETH deposit in the EntryPoint
    msg.includes("deposit for the User Operation is too low") ||
    msg.includes("Paymaster deposit")
  ) {
    // Pre-flight check provides a structured message with exact amounts — pass it through.
    if (
      msg.includes("Gasless Bridge Setup") ||
      msg.includes("top up your balance") ||
      msg.includes("is currently paused") ||
      msg.includes("ETH gas reserve") ||
      msg.includes("Gasless bridging is temporarily unavailable")
    ) {
      return msg.replace(/\n/g, " ");
    }
    // Bundler rejected due to insufficient Paymaster ETH deposit in the EntryPoint.
    if (
      msg.includes("deposit for the User Operation is too low") ||
      msg.includes("Paymaster deposit")
    ) {
      return (
        "Paymaster rejected the UserOperation — the Paymaster's gas reserve (ETH in EntryPoint) " +
        "is too low to cover this transaction. The Paymaster operator needs to replenish the " +
        "EntryPoint deposit. Try again later or use the standard bridge."
      );
    }
    // Try to surface the actual on-chain revert reason from the bundler response.
    if (/paused/i.test(msg)) {
      return (
        "Paymaster rejected the UserOperation — the Paymaster is currently paused on this chain. " +
        "Contact the Paymaster operator or try again later."
      );
    }
    if (/insufficient balance|AA33/i.test(msg)) {
      return (
        "Paymaster rejected the UserOperation — insufficient gas balance. " +
        "Go to the Paymaster page → Gasless Bridge Setup and deposit more USDC."
      );
    }
    // Generic fallback: include raw bundler reason for diagnosability.
    const rawReason = msg.length > 200 ? msg.slice(0, 200) + "…" : msg;
    return `Paymaster rejected the UserOperation — ${rawReason}`;
  }

  // On-chain execution reverted (ethers v6 throws from wait() with CALL_EXCEPTION)
  if (
    code === "CALL_EXCEPTION" ||
    msg.includes("execution reverted") ||
    msg.includes("transaction reverted")
  ) {
    const reason = (err as { reason?: string })?.reason;
    if (reason && reason !== "null") return `Transaction reverted: ${reason}`;
    // Arc Testnet doesn't return revert data — give a helpful fallback
    return "Transaction reverted on-chain. Check your USDC balance, gas, and try again.";
  }

  // Insufficient funds for gas
  if (msg.includes("insufficient funds")) {
    return "Insufficient funds for gas. Add native tokens (ETH / AVAX / etc.) to your wallet.";
  }

  // Network / RPC errors
  if (msg.includes("network") || msg.includes("could not detect")) {
    return "Network error — check your internet connection and try again.";
  }

  // Gas estimation failure (Arc Testnet broken estimateGas)
  if (msg.includes("estimateGas") || msg.includes("missing revert data")) {
    return "Gas estimation failed — the transaction may be misconfigured or the RPC is unavailable. Try again.";
  }

  if (
    msg.includes("-32080") ||
    msg.includes("HTTP client error") ||
    msg.includes("httpStatus\": 403")
  ) {
    return "Your wallet RPC stopped responding. If a transaction hash is shown below, it may already be submitted; resume that transfer instead of starting another one.";
  }

  // Return the first line only (ethers wraps long messages with newlines)
  return msg.split("\n")[0].slice(0, 200);
}

async function waitForChainSwitch(expectedChainId: number, timeoutMs = 60000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 600));
    const current = await getWalletChainId();
    if (current === expectedChainId) return;
  }
  throw new Error("Chain switch timed out. Please switch networks manually and try again.");
}

/**
 * Get a signer that is confirmed to be on the expected chain.
 *
 * MetaMask has a race condition where eth_chainId briefly reports the new chain
 * before its internal RPC router has fully switched — waitForChainSwitch returning
 * is not enough. If we acquire a signer and it reports the wrong chainId, we wait
 * a short back-off and retry, up to maxRetries times.
 *
 * This prevents receiveMessage from being submitted to the old (source) chain
 * immediately after a wallet_addEthereumChain / wallet_switchEthereumChain call.
 */
async function getSignerOnChain(expectedChainId: number, maxRetries = 6): Promise<ethers.JsonRpcSigner> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
    const provider = await getProvider();
    const signer   = await provider.getSigner();
    const network  = await provider.getNetwork();
    if (Number(network.chainId) === expectedChainId) return signer;
  }
  throw new Error(
    `Wallet is still on the wrong network after ${maxRetries} attempts. ` +
    `Please switch to the destination chain manually in MetaMask and try again.`
  );
}

/**
 * Wait for a transaction receipt with automatic retry on transient network errors.
 *
 * ethers v6 BrowserProvider can throw "underlying network changed" immediately after
 * a MetaMask chain switch — even when the transaction was already mined. In that case
 * `tx.wait()` throws before returning the receipt, making the bridge appear to have
 * failed even though the USDC arrived. This helper catches those false-negative errors
 * and retries by polling the receipt directly via a static JSON-RPC provider so we are
 * independent of MetaMask's connection state.
 */
async function waitWithRetry(
  tx: ethers.TransactionResponse,
  chain: ChainConfig,
  retries = 4,
  retryDelayMs = 4000
): Promise<ethers.TransactionReceipt> {
  const isNetworkErr = (err: unknown) => {
    const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
    return (
      msg.includes("network") ||
      msg.includes("could not detect") ||
      msg.includes("could not coalesce") ||
      msg.includes("connection") ||
      msg.includes("timeout") ||
      msg.includes("-32080") ||
      msg.includes("http client error") ||
      msg.includes("httpstatus\": 403")
    );
  };

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const receipt = await tx.wait();
      if (receipt) return receipt;
    } catch (err) {
      // Re-throw non-network errors immediately (e.g. CALL_EXCEPTION, ACTION_REJECTED)
      if (!isNetworkErr(err)) throw err;
      if (attempt === retries) throw err;
    }

    // Brief pause then try fetching the receipt directly via a static RPC provider —
    // this is independent of MetaMask's state and works even if the wallet is mid-switch.
    await new Promise((r) => setTimeout(r, retryDelayMs));
    const urls = [chain.rpcUrl, ...chain.rpcFallbacks];
    for (const url of urls) {
      try {
        const staticProvider = new ethers.JsonRpcProvider(url);
        const receipt = await staticProvider.getTransactionReceipt(tx.hash);
        if (receipt) {
          // status 0 = reverted on-chain — surface this explicitly rather than
          // treating a failed receipt as success (callers only check !receipt).
          if (receipt.status !== 1) {
            throw new Error(
              `Transaction was reverted on-chain (status 0). ` +
              `Check ${chain.explorerUrl}/tx/${tx.hash} for the revert reason.`
            );
          }
          return receipt;
        }
      } catch (innerErr) {
        // Re-throw revert errors immediately — they are definitive, not transient
        const innerMsg = (innerErr instanceof Error ? innerErr.message : String(innerErr)).toLowerCase();
        if (innerMsg.includes("reverted on-chain")) throw innerErr;
        // Otherwise try next RPC
      }
    }
  }

  throw new Error(
    "Mint transaction was not confirmed after multiple attempts. Your funds are safe — the attestation is still valid. Check the explorer and retry the mint."
  );
}

export async function getUsdcBalance(address: string, chain: ChainConfig): Promise<string> {
  const urls = [chain.rpcUrl, ...chain.rpcFallbacks];
  for (const url of urls) {
    try {
      const provider = new ethers.JsonRpcProvider(url);
      const usdc     = new ethers.Contract(chain.usdcAddress, USDC_ABI, provider);
      const balance  = await usdc.balanceOf(address);
      return ethers.formatUnits(balance, 6);
    } catch {
      // try next RPC
    }
  }
  // All RPCs failed — return sentinel so callers can distinguish from a real zero balance
  return "—";
}

function addressToBytes32(address: string): string {
  if (!ethers.isAddress(address)) {
    throw new Error(`Invalid recipient address: ${address}`);
  }
  return ethers.zeroPadValue(ethers.getAddress(address), 32);
}

function validateAmount(amount: string): bigint {
  if (!amount || amount.trim() === "") throw new Error("Please enter an amount.");
  const trimmed = amount.trim();
  // Reject scientific notation (e.g. "1e6") — ethers.parseUnits doesn't support it
  // and parseFloat would silently accept it while making the button appear enabled.
  if (/e/i.test(trimmed)) throw new Error("Please enter a plain decimal number (e.g. 1.50).");
  const parts   = trimmed.split(".");
  if (parts[1] && parts[1].length > 6) {
    throw new Error("Amount cannot have more than 6 decimal places (USDC has 6 decimals).");
  }
  let parsed: bigint;
  try {
    parsed = ethers.parseUnits(trimmed, 6);
  } catch {
    throw new Error("Invalid amount entered.");
  }
  if (parsed <= 0n) throw new Error("Amount must be greater than zero.");
  return parsed;
}

// ── CCTP message helpers ──────────────────────────────────────────────────────

/**
 * CCTP V2 message layout (big-endian):
 *   bytes  0- 3: version           (uint32)
 *   bytes  4- 7: sourceDomain      (uint32)
 *   bytes  8-11: destinationDomain (uint32)
 *   bytes 12-43: nonce             (bytes32) ← V2 uses bytes32, always 0x00 on Arc
 *   bytes 44-75: sender            (bytes32)
 *   bytes 76-107: recipient        (bytes32)
 *   bytes 108-139: destinationCaller (bytes32)
 *   bytes 140-143: minFinalityThreshold
 *   bytes 144-147: finalityThresholdExecuted
 *   bytes 148-375: BurnMessageV2 body (no hook)
 *
 * The fixed BurnMessageV2 body starts with a 4-byte version, followed by
 * burnToken, mintRecipient, amount, messageSender, maxFee, feeExecuted and
 * expirationBlock.
 * Replay protection uses the attested message nonce as the usedNonces key.
 */

/**
 * Returns true if the CCTP message has already been received on the destination.
 * Queries usedNonces(attestedMessage.nonce) on MessageTransmitterV2.
 * Safe default is false (don't assume minted if the check itself fails).
 */
async function checkNonceUsed(
  messageBytes: string,
  destChain: ChainConfig,
  signer: ethers.Signer
): Promise<boolean> {
  try {
    const nonce = decodeCctpMessage(messageBytes).nonce;
    const mt = new ethers.Contract(
      destChain.messageTransmitter,
      MESSAGE_TRANSMITTER_ABI,
      signer
    );
    const result: bigint = await mt.usedNonces(nonce);
    return result !== 0n;
  } catch {
    return false;
  }
}

// ── MessageSent parsing ───────────────────────────────────────────────────────
// The MessageTransmitter emits MessageSent(bytes message) when depositForBurn is called.
// Parsing it from the receipt gives us the raw message bytes we need for receiveMessage,
// and lets us compute the message hash to query Circle's /v1/attestations/ endpoint.

const MSG_SENT_IFACE  = new ethers.Interface(["event MessageSent(bytes message)"]);
// topic0 = keccak256("MessageSent(bytes)") — matches the event regardless of which contract emits it
const MSG_SENT_TOPIC  = MSG_SENT_IFACE.getEvent("MessageSent")!.topicHash;

export type DecodedCctpMessage = {
  version: number; sourceDomain: number; destinationDomain: number;
  nonce: string; sender: string; recipient: string; destinationCaller: string;
  minFinality: number; finalityExecuted: number; bodyVersion: number;
  burnToken: string; mintRecipient: string; amount: bigint; messageSender: string;
  maxFee: bigint; feeExecuted: bigint; expirationBlock: bigint;
};

export function decodeCctpMessage(message: string): DecodedCctpMessage {
  const bytes = ethers.getBytes(message);
  if (bytes.length !== 376) throw new Error("CCTP V2 message must be exactly 376 bytes.");
  const hex = (start: number, length: number) => `0x${message.slice(2 + start * 2, 2 + (start + length) * 2)}`;
  const u32 = (start: number) => Number(ethers.toBigInt(hex(start, 4)));
  const addr = (start: number) => ethers.getAddress(`0x${hex(start, 32).slice(-40)}`);
  return {
    version: u32(0), sourceDomain: u32(4), destinationDomain: u32(8),
    nonce: hex(12, 32), sender: hex(44, 32), recipient: hex(76, 32),
    destinationCaller: hex(108, 32), minFinality: u32(140), finalityExecuted: u32(144),
    bodyVersion: u32(148), burnToken: addr(152), mintRecipient: addr(184),
    amount: ethers.toBigInt(hex(216, 32)), messageSender: hex(248, 32),
    maxFee: ethers.toBigInt(hex(280, 32)), feeExecuted: ethers.toBigInt(hex(312, 32)),
    expirationBlock: ethers.toBigInt(hex(344, 32)),
  };
}

function parseMessageSent(receipt: ethers.TransactionReceipt, sourceMessenger: string): Array<{ message: string; logIndex: number }> {
  const result: Array<{ message: string; logIndex: number }> = [];
  for (const [logIndex, log] of receipt.logs.entries()) {
    if (log.topics[0] !== MSG_SENT_TOPIC) continue;
    if (log.address.toLowerCase() !== sourceMessenger.toLowerCase()) continue;
    try {
      const parsed = MSG_SENT_IFACE.parseLog(log);
      if (parsed?.name === "MessageSent") {
        result.push({ message: parsed.args[0] as string, logIndex });
      }
    } catch { /* not this log */ }
  }
  return result;
}

export function validateCctpMessage(
  message: string,
  source: ChainConfig,
  destination: ChainConfig,
  recipient: string,
  amount?: string,
): void {
  const decoded = decodeCctpMessage(message);
  if (decoded.version !== 1 || decoded.bodyVersion !== 1) throw new Error("Unsupported CCTP V2 message version.");
  if (decoded.sourceDomain !== source.cctpDomain || decoded.destinationDomain !== destination.cctpDomain) {
    throw new Error("CCTP message domains do not match the selected Arc/Base chains.");
  }
  if (decoded.recipient.toLowerCase() !== ethers.zeroPadValue(destination.tokenMessenger, 32).toLowerCase()) {
    throw new Error("CCTP message recipient does not match the destination TokenMessenger.");
  }
  if (decoded.destinationCaller !== ethers.ZeroHash) throw new Error("CCTP destination caller is not unrestricted.");
  if (decoded.burnToken.toLowerCase() !== source.usdcAddress.toLowerCase()) throw new Error("CCTP burn token does not match source USDC.");
  if (decoded.mintRecipient.toLowerCase() !== recipient.toLowerCase()) throw new Error("CCTP mint recipient does not match the saved destination.");
  if (amount !== undefined && decoded.amount !== ethers.parseUnits(amount, 6)) {
    throw new Error("CCTP burn amount does not match the saved transfer.");
  }
  if (decoded.maxFee !== 0n) {
    throw new Error("CCTP max fee must be zero for the standard bridge.");
  }
}

function selectSourceMessage(
  receipt: ethers.TransactionReceipt,
  source: ChainConfig,
  destination: ChainConfig,
  recipient: string,
  amount: string,
): { message: string; logIndex: number } {
  const matches = parseMessageSent(receipt, source.messageTransmitter).filter((candidate) => {
    try { validateCctpMessage(candidate.message, source, destination, recipient, amount); return true; }
    catch { return false; }
  });
  if (matches.length !== 1) throw new Error(`Expected exactly one valid source MessageSent event, found ${matches.length}.`);
  const candidate = matches[0];
  if (decodeCctpMessage(candidate.message).nonce !== ethers.ZeroHash) {
    throw new Error("Source CCTP nonce must be zero before attestation.");
  }
  if (decodeCctpMessage(candidate.message).finalityExecuted !== 0) {
    throw new Error("Source CCTP finalityExecuted must be zero before attestation.");
  }
  return candidate;
}

/**
 * Correlate the source MessageSent payload with Circle's final attested V2
 * message. Circle assigns the nonce and execution fields after the source
 * event, so full-message hashes are intentionally different.
 */
export function isMatchingAttestedMessage(sourceMessage: string, attestedMessage: string): boolean {
  try {
    const source = decodeCctpMessage(sourceMessage);
    const attested = decodeCctpMessage(attestedMessage);
    return source.nonce === ethers.ZeroHash &&
      source.finalityExecuted === 0 &&
      attested.nonce !== ethers.ZeroHash &&
      attested.finalityExecuted >= source.minFinality &&
      attested.version === source.version &&
      attested.sourceDomain === source.sourceDomain &&
      attested.destinationDomain === source.destinationDomain &&
      attested.sender === source.sender &&
      attested.recipient === source.recipient &&
      attested.destinationCaller === source.destinationCaller &&
      attested.minFinality === source.minFinality &&
      attested.bodyVersion === source.bodyVersion &&
      attested.burnToken === source.burnToken &&
      attested.mintRecipient === source.mintRecipient &&
      attested.amount === source.amount &&
      attested.messageSender === source.messageSender &&
      attested.maxFee === source.maxFee &&
      attested.feeExecuted <= attested.maxFee;
  } catch {
    return false;
  }
}

export function selectUniqueAttestedMessage(
  sourceMessage: string,
  messages: readonly string[],
): string | undefined {
  const matches = messages.filter((message) =>
    isMatchingAttestedMessage(sourceMessage, message),
  );
  if (matches.length > 1) {
    throw new Error("Iris returned multiple ambiguous completed CCTP messages.");
  }
  return matches[0];
}

// ── Attestation fetch helpers ─────────────────────────────────────────────────

type AttestationMessage = {
  attestation?: string;
  message?: string;
  status?: string;
  eventNonce?: string;
};

type FetchResult =
  | { ok: true;  messages: AttestationMessage[] }
  | { ok: false; diagnostic: string };


async function fetchAttestation(
  sourceDomain: number,
  burnTxHash: string
): Promise<FetchResult> {
  // Use the server-side proxy to avoid CORS restrictions.
  // Production proxy only; direct and sandbox fallbacks are intentionally forbidden.
  const proxyUrl = `/api/attest?domain=${sourceDomain}&txHash=${burnTxHash}`;

  try {
    const res = await fetch(proxyUrl);
    if (res.ok) {
      const data = await res.json() as { messages: AttestationMessage[]; diagnostic: string };
      if (data.messages.length > 0) return { ok: true, messages: data.messages };
      if (data.diagnostic) return { ok: false, diagnostic: `proxy → ${data.diagnostic}` };
      // 200 but empty — tx not indexed yet
      return { ok: false, diagnostic: "proxy: 200 (no messages yet)" };
    }
  } catch {
    // Proxy unreachable — fall through to direct browser calls
  }

  return { ok: false, diagnostic: "proxy unreachable" };
}

async function pollAttestation(
  sourceDomain: number,
  burnTxHash: string,
  messageBytes: string | undefined,
  onProgress: (msg: string) => void
): Promise<{ message: string; attestation: string }> {
  if (!messageBytes) throw new Error("Burn receipt did not contain a MessageSent event from the configured MessageTransmitter.");
  const source = decodeCctpMessage(messageBytes);

  onProgress(
    "Burn confirmed. Waiting for Circle attestation…"
  );

  // 600 attempts × 2 s = 20 minutes total. First attempt is immediate.
  const POLL_MS = 2000;
  const MAX_ATTEMPTS = 600;
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, POLL_MS));

    const attempt = `${i + 1}/${MAX_ATTEMPTS}`;
    const elapsedSec = (i + 1) * (POLL_MS / 1000);
    const elapsedStr = elapsedSec >= 60 ? ` · ${Math.floor(elapsedSec / 60)}m` : elapsedSec >= 10 ? ` · ${elapsedSec}s` : "";

    // ── Production V2 tx-hash endpoint; immutable-field correlation ──
    // The endpoint returns
    // "pending_confirmations" while Circle is waiting for block finality, then
    // "complete" with the message + attestation once ready.
    const txResult = await fetchAttestation(sourceDomain, burnTxHash);
    if (txResult.ok) {
      const completed = txResult.messages.filter(
        (message): message is AttestationMessage & { message: string; attestation: string } =>
          !!message.message && !!message.attestation && message.attestation !== "PENDING",
      );
      const selected = selectUniqueAttestedMessage(
        messageBytes,
        completed.map((message) => message.message),
      );
      if (selected) {
        const match = completed.find((message) => message.message === selected)!;
        return { message: match.message, attestation: match.attestation };
      }
      // Tx-hash path found the message but not yet attested — show status
      const status = txResult.messages[0]?.status ?? txResult.messages[0]?.attestation ?? "pending_confirmations";
      onProgress(`Waiting for attestation… (${attempt}${elapsedStr}) — ${status}`);
      continue;
    }

    // Both paths returned no result yet — show a quiet waiting message
    onProgress(`Waiting for attestation… (${attempt}${elapsedStr})`);
  }

  throw new Error(
    `Attestation timed out after 20 minutes.\n` +
    `Your USDC has been burned on the source chain and is safe — do NOT initiate another burn or you risk a second burn going unattested.\n` +
    `Burn tx: ${burnTxHash}\n` +
    `This is a known intermittent issue with Circle's IRIS attestation service for Arc (domain 26). ` +
    `Check https://status.circle.com for incidents, then use "Resume" in the bridge UI once attestations recover. ` +
    `If still stuck after 24 hours, contact Circle support with your burn tx hash above.`
  );
}

/**
 * Fetch the current gas price and apply a 30% upward bump.
 *
 * Arc Testnet's eth_gasPrice returns a stale baseline. Without the premium,
 * back-to-back transactions (approve → fee → burn) fail with
 * "replacement transaction underpriced". See arc-node#87.
 * Returns undefined if the provider can't supply fee data (non-blocking).
 */
/**
 * Fetch a transaction receipt, trying each chain RPC URL in order until one succeeds.
 * Returns null if the receipt is genuinely not yet available (tx pending on all RPCs),
 * or if all RPCs are unresponsive (treats as pending to allow retry).
 */
async function getReceiptAnyRpc(
  txHash: string,
  chain: ChainConfig
): Promise<ethers.TransactionReceipt | null> {
  for (const url of [chain.rpcUrl, ...chain.rpcFallbacks]) {
    try {
      const p = new ethers.JsonRpcProvider(url);
      const receipt = await p.getTransactionReceipt(txHash);
      if (receipt !== null) return receipt;
    } catch {
      // RPC unresponsive or rate-limited — try next fallback
    }
  }
  return null;
}

async function getBumpedGasPrice(signer: ethers.Signer): Promise<bigint | undefined> {
  try {
    const feeData = await signer.provider!.getFeeData();
    if (!feeData.gasPrice) return undefined;
    return (feeData.gasPrice * 130n) / 100n;
  } catch {
    return undefined;
  }
}

// ── Burn path: approve → simulate → standard CCTP V2 depositForBurn ────────

async function burnWithManualFee(
  fromChain: ChainConfig,
  toChain: ChainConfig,
  grossAmountInUnits: bigint,
  mintRecipient: string,
  signer: ethers.Signer,
  signerAddress: string,
  onStatusChange: (status: BridgeStatus) => void
): Promise<{ burnTxHash: string; feeTxHash?: string; messageBytes?: string; sourceLogIndex?: number }> {
  const mintRecipient32 = addressToBytes32(mintRecipient);
  const usdc            = new ethers.Contract(fromChain.usdcAddress, USDC_ABI, signer);

  // Set up TokenMessenger early so we can static-call it before the fee transfer.
  const messengerAbi   = TOKEN_MESSENGER_V2_ABI;
  const tokenMessenger = new ethers.Contract(fromChain.tokenMessenger, messengerAbi, signer);
  const finalityThreshold = fromChain.minFinalityThreshold ?? 1000;

  // ── Step 1: Approve TokenMessenger for bridge amount only ──────────────
  onStatusChange({ step: "approving", message: "Checking USDC allowance..." });

  // Fetch a bumped gas price once upfront and reuse for all three write calls.
  // Arc Testnet returns a stale baseline from eth_gasPrice — back-to-back transactions
  // (approve → fee → burn) fail with "replacement transaction underpriced" without ≥30%
  // premium. See arc-node#87. On chains that don't return gasPrice this returns undefined
  // and ethers.js uses the default estimation.
  const gasPrice = await getBumpedGasPrice(signer);

  // Always provide conservative gas limits for wallet writes. Some wallet RPCs
  // reject eth_estimateGas with HTTP 403 even though the transaction is valid.
  // Unused gas is not charged.
  const commonWriteOverrides: Record<string, unknown> = {
    ...(gasPrice !== undefined    && { gasPrice }),
  };
  const approveOverrides = {
    ...commonWriteOverrides,
    gasLimit: APPROVE_GAS_LIMIT,
  };
  const burnOverrides = {
    ...commonWriteOverrides,
    gasLimit: fromChain.gasLimitOverride ?? CCTP_WRITE_GAS_LIMIT,
  };

  const allowance: bigint = await usdc.allowance(signerAddress, fromChain.tokenMessenger);
  if (allowance < grossAmountInUnits) {
    const approveTx = await usdc.approve(fromChain.tokenMessenger, grossAmountInUnits, approveOverrides);
    onStatusChange({
      step: "approving",
      message: "Approval submitted, waiting for confirmation...",
      txHash: approveTx.hash,
    });
    const approveReceipt = await waitWithRetry(approveTx, fromChain);
    if (!approveReceipt) throw new Error("Approval transaction was not confirmed. Please try again.");
  } else {
    onStatusChange({ step: "approving", message: "Allowance sufficient, skipping approval." });
  }

  // ── Pre-flight: simulate the burn before charging the fee ──────────────
  // Run a gas-free eth_call that mirrors depositForBurn exactly.
  // We use our own JsonRpcProvider (not MetaMask) so that:
  //   a) the `from` field is reliably included (MetaMask can drop it in eth_call)
  //   b) we can try fallback RPCs if the primary is down
  //   c) error objects include the full revert reason, not just a status code
  // We pass `from: signerAddress` so the on-chain allowance we just set is visible.
  // Strategy: CALL_EXCEPTION = real contract revert → block and report.
  //           Any other error = RPC unreachable / timeout → warn and proceed
  //           (the actual send will fail visibly if there's a real problem).
  onStatusChange({ step: "approving", message: "Simulating cross-chain transfer..." });

  const burnArgs = [grossAmountInUnits, toChain.cctpDomain, mintRecipient32,
       fromChain.usdcAddress, ethers.ZeroHash, 0n, finalityThreshold]

  let simCallException: { reason?: string; shortMessage?: string } | null = null;
  let simRpcFailed = false;

  for (const rpcUrl of [fromChain.rpcUrl, ...fromChain.rpcFallbacks]) {
    try {
      const simProvider = new ethers.JsonRpcProvider(rpcUrl);
      const simContract  = new ethers.Contract(fromChain.tokenMessenger, messengerAbi, simProvider);
      const simRequest = await simContract.depositForBurn.populateTransaction(...burnArgs);
      // Use a raw eth_call rather than Contract.staticCall. Arc's live
      // TokenMessenger succeeds with empty return data even though the published
      // ABI declares a return value; decoding that empty value produces BAD_DATA.
      await simProvider.call({ ...simRequest, from: signerAddress });
      // Simulation passed — break and proceed to fee transfer
      simCallException = null;
      simRpcFailed = false;
      break;
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      if (code === "CALL_EXCEPTION") {
        // Contract reverted — record and stop trying other RPCs (they'd give the same result)
        simCallException = err as { reason?: string; shortMessage?: string };
        simRpcFailed = false;
        break;
      }
      // Network / parse error — try next RPC
      simRpcFailed = true;
    }
  }

  if (simCallException !== null) {
    const reason = simCallException.reason ?? simCallException.shortMessage;
    const detail = reason && reason !== "null" ? `: ${reason}` : "";
    throw new Error(
      `Transfer would revert on-chain${detail}. No fee has been charged. ` +
      `Check your USDC balance, allowance, and that the bridge contracts are reachable on ${fromChain.shortName}.`
    );
  }
  if (simRpcFailed) {
    // All RPCs were unreachable — simulation inconclusive.
    // Proceed optimistically; if the burn truly reverts the fee tx will be the only loss,
    // but the user has been warned and can see the fee step before approving.
    // (No console.warn in production — RPC unreachability is not actionable by the user)
  }

  // ── Step 2: depositForBurn ─────────────────────────────────────────────
  onStatusChange({ step: "burning", message: "Initiating cross-chain transfer..." });

  // CCTP V2 (Arc Testnet) requires three extra parameters:
  //   destinationCaller = bytes32(0) → anyone may relay
  //   maxFee            = 0          → no premium for fast finality
  //   minFinalityThreshold           → per-chain setting
  const burnTx = await tokenMessenger.depositForBurn(
         grossAmountInUnits,
        toChain.cctpDomain,
        mintRecipient32,
        fromChain.usdcAddress,
        ethers.ZeroHash,     // destinationCaller = 0 (anyone)
        0n,                  // maxFee = 0
        finalityThreshold,
        burnOverrides
      );

  onStatusChange({
    step: "burning",
    message: "Burn transaction submitted, waiting for confirmation...",
    burnTxHash: burnTx.hash,
  });

  const burnReceipt = await waitWithRetry(burnTx, fromChain);
  if (!burnReceipt) {
    throw new Error("Burn transaction was not confirmed. Please check the explorer and try again.");
  }

  const sourceCandidate = selectSourceMessage(
    burnReceipt, fromChain, toChain, mintRecipient, ethers.formatUnits(grossAmountInUnits, 6)
  );
  return { burnTxHash: burnReceipt.hash, messageBytes: sourceCandidate.message, sourceLogIndex: sourceCandidate.logIndex };
}

// ── Main entry point ────────────────────────────────────────────────────────

// ── Gas Relay API ─────────────────────────────────────────────────────────────

/** Flat relay fee this UI expects — must match GasRelayer.relayFee() on-chain (1 USDC). */
export const GAS_RELAY_FEE_UNITS = 1_000_000n;

/**
 * Call the /api/relay endpoint to have the server submit GasRelayer.relay() on the
 * destination chain.  The user burned USDC with mintRecipient = GasRelayer contract,
 * so the contract mints and forwards (amount - relayFee) to `recipient`.
 * Returns the relay transaction hash.
 */
async function callGasRelayApi(
  toChain: ChainConfig,
  message: string,
  attestation: string,
  recipient: string,
  maxFee: bigint,
): Promise<string> {
  const resp = await fetch("/api/relay", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      attestation,
      recipient,
      destChainId: toChain.id,
      maxFee: maxFee.toString(),
    }),
  });
  const data = await resp.json().catch(() => ({})) as { txHash?: string; error?: string };
  if (!resp.ok || !data.txHash) {
    throw new Error(data.error ?? `Gas relay request failed (HTTP ${resp.status})`);
  }
  return data.txHash;
}

export async function executeBridge(
  fromChain: ChainConfig,
  toChain: ChainConfig,
  amount: string,
  recipientAddress: string,
  onStatusChange: (status: BridgeStatus) => void,
  options?: { useGasRelay?: boolean }
): Promise<void> {
  assertFeatureAvailable("bridge");
  await assertBackendEnvironment();
  if (fromChain.id === toChain.id) {
    throw new Error("Source and destination chains must be different.");
  }
  if (!ethers.isAddress(recipientAddress)) {
    throw new Error(`Invalid recipient address: ${recipientAddress}`);
  }

  const grossAmountInUnits = validateAmount(amount);

  const currentChainId = await getWalletChainId();
  if (currentChainId !== fromChain.id) {
    throw new Error(`Wallet is on the wrong network. Please switch to ${fromChain.name} first.`);
  }

  const provider      = await getProvider();
  const signer        = await provider.getSigner();
  const signerAddress = await signer.getAddress();
  let destinationNativeBalance: bigint;
  try {
    destinationNativeBalance = await new ethers.JsonRpcProvider(toChain.rpcUrl).getBalance(signerAddress);
  } catch {
    throw new Error(
      `Unable to verify ${toChain.shortName} destination gas readiness. ` +
      `Fund the connected wallet on ${toChain.name}, then try again.`,
    );
  }
  if (toChain.isArc && !hasArcMintGasReserve(destinationNativeBalance)) {
    throw new Error("Destination Arc gas is insufficient: fund the connected wallet with at least 0.02 native USDC (18 decimals) before bridging. The connected signer pays receiveMessage gas.");
  }
  if (!toChain.isArc && !hasBaseMintGasReserve(destinationNativeBalance)) {
    throw new Error("Destination Base gas is insufficient: fund the connected wallet with at least 0.0001 ETH before bridging. The connected signer pays receiveMessage gas.");
  }

  // Pre-flight balance check — fail early with a clear message
  const usdcForCheck = new ethers.Contract(fromChain.usdcAddress, USDC_ABI, signer);
  const usdcBalance: bigint = await usdcForCheck.balanceOf(signerAddress);
  if (usdcBalance < grossAmountInUnits) {
    const have = ethers.formatUnits(usdcBalance, 6);
    const need = ethers.formatUnits(grossAmountInUnits, 6);
    throw new Error(
      `Insufficient USDC balance. You have ${have} USDC but need ${need} USDC.`
    );
  }
  // Arc's native gas asset is USDC with 18 decimals. Never spend the reserve
  // needed to submit the burn (or strand a wallet with no gas).
  if (fromChain.isArc) {
    const nativeBalance = await provider.getBalance(signerAddress);
    const reserve = ARC_MINT_GAS_RESERVE;
    const required = grossAmountInUnits * 1_000_000_000_000n + reserve;
    if (nativeBalance < required) {
      throw new Error(
        `Insufficient Arc USDC gas reserve. Keep at least 0.02 USDC for gas; ` +
        `your requested transfer would leave less than the safe reserve.`
      );
    }
  }

  const useGasRelay = false;
  // When relaying, the CCTP mintRecipient is the GasRelayer contract on the destination chain.
  // The GasRelayer then mints USDC to itself and forwards (amount - relayFee) to the user.
  const mintRecipientForBurn = useGasRelay ? toChain.gasRelayerAddress! : recipientAddress;

  const result = await burnWithManualFee(
    fromChain, toChain, grossAmountInUnits, mintRecipientForBurn,
    signer, signerAddress, onStatusChange
  );
  const burnTxHash   = result.burnTxHash;
  const feeTxHash    = result.feeTxHash;
  const messageBytes = result.messageBytes;
  const sourceLogIndex = result.sourceLogIndex;

  // ── Attest ────────────────────────────────────────────────────────────
  onStatusChange({
    step: "attesting",
    message: messageBytes
      ? "Burn confirmed. Fetching Circle attestation via message hash…"
      : "Burn confirmed. Requesting attestation from Circle...",
    feeTxHash,
    burnTxHash,
    messageBytes,
    sourceLogIndex,
  });

  const attestationResult = await pollAttestation(
    fromChain.cctpDomain,
    burnTxHash,
    messageBytes,
    (msg) => onStatusChange({ step: "attesting", message: msg, feeTxHash, burnTxHash, messageBytes, sourceLogIndex })
  );

  if (useGasRelay) {
    // ── Gas Relay path: no wallet switch, server mints on behalf of user ──────
    onStatusChange({
      step: "minting",
      message: "Requesting gasless relay — server will mint USDC on your behalf...",
      feeTxHash,
      burnTxHash,
    });

    const relayTxHash = await callGasRelayApi(
      toChain,
      attestationResult.message,
      attestationResult.attestation,
      recipientAddress,
      GAS_RELAY_FEE_UNITS * 2n,   // maxFee = 2× expected, guards against sudden fee bumps
    );

    onStatusChange({
      step: "minting",
      message: "Relay submitted — waiting for confirmation on destination chain...",
      feeTxHash,
      burnTxHash,
      mintTxHash: relayTxHash,
    });

    // Poll for the relay tx receipt on the destination chain, using fallback RPCs so a
    // single unresponsive node doesn't falsely report the relay as unconfirmed.
    let relayReceipt: ethers.TransactionReceipt | null = null;
    for (let i = 0; i < 60; i++) {
      relayReceipt = await getReceiptAnyRpc(relayTxHash, toChain);
      if (relayReceipt) break;
      await new Promise((r) => setTimeout(r, 5000));
    }
    if (!relayReceipt) {
      throw new Error(
        `Relay transaction submitted (${relayTxHash}) but not yet confirmed. ` +
        `Check ${toChain.explorerUrl}/tx/${relayTxHash} — your USDC will arrive once it confirms.`
      );
    }

    if (relayReceipt.status === 0) {
      throw new Error(
        `Relay transaction reverted on-chain — the GasRelayer contract rejected the mint.\n` +
        `Relay tx: ${relayTxHash}\n` +
        `Check ${toChain.explorerUrl}/tx/${relayTxHash} for the revert reason. ` +
        `Your burn is confirmed and the attestation is still valid — contact support for recovery.`
      );
    }

    const netAmount = formatUsdc(grossAmountInUnits);
    onStatusChange({
      step: "done",
      message: `Relay complete! ${netAmount} USDC arrived on ${toChain.name} (1 USDC relay fee deducted).`,
      feeTxHash,
      burnTxHash,
      mintTxHash: relayReceipt.hash,
    });

  } else {
    // ── Standard path: user switches chain + calls receiveMessage ────────────
    onStatusChange({
      step: "minting",
      message: `Switching to ${toChain.name} to mint USDC...`,
      feeTxHash,
      burnTxHash,
    });

    await switchToChain(toChain);
    await waitForChainSwitch(toChain.id);

    // Re-verify the signer is on the right chain — MetaMask has a brief race where
    // eth_chainId reports the new chain before the RPC router has actually switched.
    const destSigner = await getSignerOnChain(toChain.id);

    // Nonce replay check — message may have been minted in a previous attempt
    const alreadyMinted = await checkNonceUsed(attestationResult.message, toChain, destSigner);
    if (alreadyMinted) {
      const receivedAmount = formatUsdc(grossAmountInUnits);
      onStatusChange({
        step: "done",
        message: `Already bridged! ${receivedAmount} USDC is on ${toChain.name} (message was previously received).`,
        feeTxHash,
        burnTxHash,
      });
      return;
    }

    const messageTransmitter = new ethers.Contract(
      toChain.messageTransmitter,
      MESSAGE_TRANSMITTER_ABI,
      destSigner
    );

    onStatusChange({ step: "minting", message: "Minting USDC on destination chain...", feeTxHash, burnTxHash });

    // Arc Testnet as destination requires a bumped gas price — eth_gasPrice on Arc
    // can be stale or elevated, causing "underpriced" failures without the 30% bump.
    const mintOverrides: Record<string, bigint> = {
      gasLimit: toChain.gasLimitOverride ?? CCTP_WRITE_GAS_LIMIT,
    };
    if (toChain.isArc) {
      const bumpedGasPrice = await getBumpedGasPrice(destSigner);
      if (bumpedGasPrice !== undefined) mintOverrides.gasPrice = bumpedGasPrice;
    }
    const mintTx = await messageTransmitter.receiveMessage(
      attestationResult.message,
      attestationResult.attestation,
      mintOverrides
    );

    onStatusChange({
      step: "minting",
      message: "Mint transaction submitted, waiting for confirmation...",
      feeTxHash,
      burnTxHash,
      mintTxHash: mintTx.hash,
    });

    const mintReceipt = await waitWithRetry(mintTx, toChain);

    const receivedAmount = formatUsdc(grossAmountInUnits);
    onStatusChange({
      step: "done",
      message: `Bridge complete! ${receivedAmount} USDC has arrived on ${toChain.name}.`,
      feeTxHash,
      burnTxHash,
      mintTxHash: mintReceipt.hash,
    });
  }
}

// ── Resume (attestation + mint only) ─────────────────────────────────────────

/**
 * Resume an interrupted bridge from the attestation step.
 * Used when the user has a saved session from a previous page visit.
 * Skips approve/burn — picks up from attestation through to mint.
 */
export async function resumeBridge(
  fromChain: ChainConfig,
  toChain: ChainConfig,
  burnTxHash: string,
  messageBytes: string | undefined,
  feeTxHash: string | undefined,
  recipient: string,
  amount: string,
  sourceMessageHash: string | undefined,
  sourceLogIndex: number | undefined,
  onStatusChange: (status: BridgeStatus) => void
): Promise<void> {
  assertFeatureAvailable("bridge");
  await assertBackendEnvironment();
  if (fromChain.id !== 5042 && fromChain.id !== 8453 || toChain.id !== 5042 && toChain.id !== 8453 ||
      fromChain.id === toChain.id) throw new Error("Resume is restricted to Arc Mainnet and Base Mainnet.");
  const receipt = await getReceiptAnyRpc(burnTxHash, fromChain);
  if (!receipt || receipt.status !== 1) {
    throw new Error("The source burn receipt is unavailable or failed; no wallet action was requested.");
  }
  const sourceCandidate = selectSourceMessage(receipt, fromChain, toChain, recipient, amount);
  if (sourceMessageHash && ethers.keccak256(sourceCandidate.message) !== sourceMessageHash) {
    throw new Error("Saved source message hash does not match the authoritative receipt.");
  }
  if (sourceLogIndex !== undefined && sourceCandidate.logIndex !== sourceLogIndex) {
    throw new Error("Saved source MessageSent log index does not match the authoritative receipt.");
  }
  if (messageBytes && ethers.keccak256(messageBytes) !== ethers.keccak256(sourceCandidate.message)) {
    throw new Error("Saved source CCTP message does not match the authoritative receipt.");
  }
  messageBytes = sourceCandidate.message;
  onStatusChange({
    step: "attesting",
    message: messageBytes
      ? "Resuming: waiting for Circle attestation via message hash…"
      : "Resuming: waiting for Circle attestation…",
    feeTxHash,
    burnTxHash,
    messageBytes,
  });

  const attestationResult = await pollAttestation(
    fromChain.cctpDomain,
    burnTxHash,
    messageBytes,
    (msg) => onStatusChange({ step: "attesting", message: msg, feeTxHash, burnTxHash, messageBytes })
  );

  onStatusChange({
    step: "minting",
    message: `Switching to ${toChain.name} to mint USDC…`,
    feeTxHash,
    burnTxHash,
  });

  await switchToChain(toChain);
  await waitForChainSwitch(toChain.id);

  // Re-verify the signer is on the right chain — MetaMask has a brief race where
  // eth_chainId reports the new chain before the RPC router has actually switched.
  const destSigner = await getSignerOnChain(toChain.id);

  // Nonce replay check — may have already been minted
  const alreadyMinted = await checkNonceUsed(attestationResult.message, toChain, destSigner);
  if (alreadyMinted) {
    onStatusChange({
      step: "done",
      message: `Already bridged! USDC has arrived on ${toChain.name} (message was previously received).`,
      feeTxHash,
      burnTxHash,
    });
    return;
  }

  const messageTransmitter = new ethers.Contract(
    toChain.messageTransmitter,
    MESSAGE_TRANSMITTER_ABI,
    destSigner
  );

  onStatusChange({ step: "minting", message: "Minting USDC on destination chain...", feeTxHash, burnTxHash });

  // Arc Testnet as destination requires a bumped gas price — eth_gasPrice on Arc
  // can be stale or elevated, causing "underpriced" failures without the 30% bump.
  const mintOverrides: Record<string, bigint> = {
    gasLimit: toChain.gasLimitOverride ?? CCTP_WRITE_GAS_LIMIT,
  };
  if (toChain.isArc) {
    const bumpedGasPrice = await getBumpedGasPrice(destSigner);
    if (bumpedGasPrice !== undefined) mintOverrides.gasPrice = bumpedGasPrice;
  }
  const mintTx = await messageTransmitter.receiveMessage(
    attestationResult.message,
    attestationResult.attestation,
    mintOverrides
  );

  onStatusChange({
    step: "minting",
    message: "Mint transaction submitted, waiting for confirmation...",
    feeTxHash,
    burnTxHash,
    mintTxHash: mintTx.hash,
  });

  const mintReceipt = await waitWithRetry(mintTx, toChain);

  onStatusChange({
    step: "done",
    message: `Bridge complete! USDC has arrived on ${toChain.name}.`,
    feeTxHash,
    burnTxHash,
    mintTxHash: mintReceipt.hash,
  });
}


// ── Resume — gas relay path ───────────────────────────────────────────────────

/**
 * Resume an interrupted gas-relay bridge from the attestation step.
 * Used when the session was saved with useGasRelay=true.
 *
 * The burn's mintRecipient was the GasRelayer contract, so we must call
 * the relay API — NOT receiveMessage directly — to get USDC to the user.
 */
export async function resumeBridgeGasRelay(
  fromChain: ChainConfig,
  toChain: ChainConfig,
  burnTxHash: string,
  messageBytes: string | undefined,
  feeTxHash: string | undefined,
  recipientAddress: string,
  onStatusChange: (status: BridgeStatus) => void
): Promise<void> {
  assertFeatureAvailable("relay");
  await assertBackendEnvironment();
  onStatusChange({
    step: "attesting",
    message: messageBytes
      ? "Resuming: waiting for Circle attestation via message hash…"
      : "Resuming: waiting for Circle attestation…",
    feeTxHash,
    burnTxHash,
    messageBytes,
  });

  const attestationResult = await pollAttestation(
    fromChain.cctpDomain,
    burnTxHash,
    messageBytes,
    (msg) => onStatusChange({ step: "attesting", message: msg, feeTxHash, burnTxHash, messageBytes })
  );

  onStatusChange({
    step: "minting",
    message: "Requesting gasless relay — server will mint USDC on your behalf…",
    feeTxHash,
    burnTxHash,
  });

  const relayTxHash = await callGasRelayApi(
    toChain,
    attestationResult.message,
    attestationResult.attestation,
    recipientAddress,
    GAS_RELAY_FEE_UNITS * 2n,
  );

  onStatusChange({
    step: "minting",
    message: "Relay submitted — waiting for confirmation on destination chain…",
    feeTxHash,
    burnTxHash,
    mintTxHash: relayTxHash,
  });

  // Poll for the relay tx receipt, using fallback RPCs so a single unresponsive
  // node doesn't falsely report the relay as unconfirmed.
  let relayReceipt: ethers.TransactionReceipt | null = null;
  for (let i = 0; i < 60; i++) {
    relayReceipt = await getReceiptAnyRpc(relayTxHash, toChain);
    if (relayReceipt) break;
    await new Promise((r) => setTimeout(r, 5000));
  }

  if (!relayReceipt) {
    throw new Error(
      `Relay transaction submitted (${relayTxHash}) but not yet confirmed. ` +
      `Check ${toChain.explorerUrl}/tx/${relayTxHash} — your USDC will arrive once it confirms.`
    );
  }

  if (relayReceipt.status === 0) {
    throw new Error(
      `Relay transaction reverted on-chain — the GasRelayer contract rejected the mint.\n` +
      `Relay tx: ${relayTxHash}\n` +
      `Check ${toChain.explorerUrl}/tx/${relayTxHash} for the revert reason. ` +
      `Your burn is confirmed and the attestation is still valid — contact support for recovery.`
    );
  }

  onStatusChange({
    step: "done",
    message: `Relay complete! USDC has arrived on ${toChain.name} (relay fee deducted).`,
    feeTxHash,
    burnTxHash,
    mintTxHash: relayReceipt.hash,
  });
}
