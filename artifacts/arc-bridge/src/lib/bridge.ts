import { ethers } from "ethers";
import {
  ChainConfig,
  USDC_ABI,
  TOKEN_MESSENGER_ABI,
  TOKEN_MESSENGER_V2_ABI,
  MESSAGE_TRANSMITTER_ABI,
  ATTESTATION_API,
} from "./chains";
import { calculateFee, formatUsdc } from "./config";

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

export interface BridgeStatus {
  step: BridgeStep;
  message: string;
  txHash?: string;
  feeTxHash?: string;
  burnTxHash?: string;
  mintTxHash?: string;
  messageBytes?: string;
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
      msg.includes("connection") ||
      msg.includes("timeout")
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
        if (receipt) return receipt;
      } catch {
        // try next RPC
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
 *   bytes 140+:  messageBody
 *
 * Note: Arc's CCTP V2 implementation encodes nonce as all-zero bytes32.
 * Replay protection uses keccak256(messageBytes) as the usedNonces key — NOT
 * keccak256(sourceDomain, nonce) as in CCTP V1.
 */

/**
 * Returns true if the CCTP message has already been received on the destination.
 * Queries usedNonces(keccak256(messageBytes)) on the MessageTransmitter.
 * Safe default is false (don't assume minted if the check itself fails).
 */
async function checkNonceUsed(
  messageBytes: string,
  destChain: ChainConfig,
  signer: ethers.Signer
): Promise<boolean> {
  try {
    // CCTP V2 replay protection key is the hash of the full message bytes.
    const messageHash = ethers.keccak256(messageBytes);
    const mt = new ethers.Contract(
      destChain.messageTransmitter,
      MESSAGE_TRANSMITTER_ABI,
      signer
    );
    const result: bigint = await mt.usedNonces(messageHash);
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

function parseMessageSent(receipt: ethers.TransactionReceipt): string | undefined {
  for (const log of receipt.logs) {
    if (log.topics[0] !== MSG_SENT_TOPIC) continue;
    try {
      const parsed = MSG_SENT_IFACE.parseLog(log);
      if (parsed?.name === "MessageSent") {
        return parsed.args[0] as string;
      }
    } catch { /* not this log */ }
  }
  return undefined;
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

type HashResult =
  | { ok: true;  attestation: string }
  | { ok: false; status: string; diagnostic: string };

async function fetchAttestation(
  sourceDomain: number,
  burnTxHash: string
): Promise<FetchResult> {
  // Use the server-side proxy to avoid CORS restrictions.
  // Falls back to direct browser calls if the proxy is unreachable.
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

  // Direct browser fallback (may hit CORS on some hosts)
  const endpoints: Array<{ label: string; url: string }> = [
    { label: "v2", url: `${ATTESTATION_API}/v2/messages/${sourceDomain}?transactionHash=${burnTxHash}` },
    { label: "v1", url: `${ATTESTATION_API}/v1/messages/${sourceDomain}/${burnTxHash}` },
  ];
  const errors: string[] = ["proxy: unreachable"];

  for (const { label, url } of endpoints) {
    try {
      const res = await fetch(url);
      let body = "";
      try { body = await res.text(); } catch { /* ignore */ }

      if (!res.ok) {
        let detail = `${res.status}`;
        try {
          const parsed = JSON.parse(body);
          const msg = parsed?.error ?? parsed?.message ?? parsed?.detail;
          if (msg) detail += ` — ${String(msg).slice(0, 80)}`;
        } catch { /* body not JSON */ }
        errors.push(`${label}: ${detail}`);
        continue;
      }

      let data: Record<string, unknown> = {};
      try { data = JSON.parse(body); } catch { errors.push(`${label}: invalid JSON`); continue; }

      const msgs: AttestationMessage[] = (data?.messages as AttestationMessage[]) ?? [];
      if (msgs.length > 0) return { ok: true, messages: msgs };
      errors.push(`${label}: 200 (no messages)`);
    } catch (e) {
      const detail = e instanceof TypeError ? "network/CORS error" : String(e).slice(0, 60);
      errors.push(`${label}: ${detail}`);
    }
  }

  return { ok: false, diagnostic: errors.join(" | ") };
}

/** Poll the content-based /v1/attestations/{messageHash} endpoint. */
async function fetchAttestationByHash(messageHash: string): Promise<HashResult> {
  try {
    const res = await fetch(`/api/attest/hash/${messageHash}`);
    if (!res.ok) return { ok: false, status: "", diagnostic: `proxy: ${res.status}` };
    const data = await res.json() as { attestation: string | null; status: string | null; diagnostic: string };
    if (data.diagnostic) return { ok: false, status: data.status ?? "", diagnostic: data.diagnostic };
    if (data.attestation && data.attestation !== "PENDING") {
      return { ok: true, attestation: data.attestation };
    }
    return { ok: false, status: data.status ?? "PENDING", diagnostic: `hash: ${data.status ?? "pending"}` };
  } catch (e) {
    return { ok: false, status: "", diagnostic: `proxy error: ${e instanceof Error ? e.message.slice(0, 60) : "unknown"}` };
  }
}

async function pollAttestation(
  sourceDomain: number,
  burnTxHash: string,
  messageBytes: string | undefined,
  onProgress: (msg: string) => void
): Promise<{ message: string; attestation: string }> {
  const messageHash = messageBytes ? ethers.keccak256(messageBytes) : undefined;

  onProgress(
    messageHash
      ? "Burn confirmed. Waiting for Circle attestation via message hash…"
      : "Burn confirmed. Waiting for Circle attestation (this can take a few minutes on testnet)…"
  );

  // 600 attempts × 2 s = 20 minutes total. First attempt is immediate.
  const POLL_MS = 2000;
  const MAX_ATTEMPTS = 600;
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, POLL_MS));

    const attempt = `${i + 1}/${MAX_ATTEMPTS}`;
    const elapsedSec = (i + 1) * (POLL_MS / 1000);
    const elapsedStr = elapsedSec >= 60 ? ` · ${Math.floor(elapsedSec / 60)}m` : elapsedSec >= 10 ? ` · ${elapsedSec}s` : "";

    // ── Path 1: message-hash endpoint (/v1/attestations/{hash}) ────────────
    // Returns a signed attestation once Circle has confirmed the message.
    // While Circle is still waiting for finality it returns 404 — that is
    // normal "pending" behaviour, NOT an error.
    if (messageHash && messageBytes) {
      const hashResult = await fetchAttestationByHash(messageHash);
      if (hashResult.ok) {
        return { message: messageBytes, attestation: hashResult.attestation };
      }
    }

    // ── Path 2: tx-hash endpoint (/v2/messages/{domain}?transactionHash=) ──
    // Also tried every round.  For Arc Testnet this endpoint works and returns
    // "pending_confirmations" while Circle is waiting for block finality, then
    // "complete" with the message + attestation once ready.
    const txResult = await fetchAttestation(sourceDomain, burnTxHash);
    if (txResult.ok) {
      const complete = txResult.messages.find(
        (m) => m.attestation && m.attestation !== "PENDING" && m.message
      );
      if (complete?.attestation && complete?.message) {
        return { message: complete.message, attestation: complete.attestation };
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
    `Attestation timed out after 20 minutes. Your funds are safe — the burn is confirmed on-chain.\n` +
    `Burn tx: ${burnTxHash}\n` +
    `You can resume the mint from the bridge UI or manually at https://developers.circle.com/stablecoins/cctp-getting-started`
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
async function getBumpedGasPrice(signer: ethers.Signer): Promise<bigint | undefined> {
  try {
    const feeData = await signer.provider!.getFeeData();
    if (!feeData.gasPrice) return undefined;
    return (feeData.gasPrice * 130n) / 100n;
  } catch {
    return undefined;
  }
}

// ── Burn path: approve → simulate → transfer fee → depositForBurn ─────────

async function burnWithManualFee(
  fromChain: ChainConfig,
  toChain: ChainConfig,
  grossAmountInUnits: bigint,
  mintRecipient: string,
  signer: ethers.Signer,
  signerAddress: string,
  onStatusChange: (status: BridgeStatus) => void
): Promise<{ burnTxHash: string; feeTxHash?: string; messageBytes?: string }> {
  const fee             = calculateFee(grossAmountInUnits);
  const mintRecipient32 = addressToBytes32(mintRecipient);
  const usdc            = new ethers.Contract(fromChain.usdcAddress, USDC_ABI, signer);

  // Set up TokenMessenger early so we can static-call it before the fee transfer.
  const isV2           = fromChain.cctpVersion === 2;
  const messengerAbi   = isV2 ? TOKEN_MESSENGER_V2_ABI : TOKEN_MESSENGER_ABI;
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

  // Build base overrides: explicit gasLimit on chains where eth_estimateGas is unreliable
  // (e.g. Arc Testnet), plus the bumped gas price on all chains. See arc-node#80.
  const writeOverrides: Record<string, unknown> = {
    ...(fromChain.gasLimitOverride && { gasLimit: fromChain.gasLimitOverride }),
    ...(gasPrice !== undefined    && { gasPrice }),
  };

  const allowance: bigint = await usdc.allowance(signerAddress, fromChain.tokenMessenger);
  if (allowance < fee.bridgeAmount) {
    const approveTx = await usdc.approve(fromChain.tokenMessenger, fee.bridgeAmount, writeOverrides);
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

  const burnArgs = isV2
    ? [fee.bridgeAmount, toChain.cctpDomain, mintRecipient32,
       fromChain.usdcAddress, ethers.ZeroHash, 0n, finalityThreshold]
    : [fee.bridgeAmount, toChain.cctpDomain, mintRecipient32, fromChain.usdcAddress];

  let simCallException: { reason?: string; shortMessage?: string } | null = null;
  let simRpcFailed = false;

  for (const rpcUrl of [fromChain.rpcUrl, ...fromChain.rpcFallbacks]) {
    try {
      const simProvider = new ethers.JsonRpcProvider(rpcUrl);
      const simContract  = new ethers.Contract(fromChain.tokenMessenger, messengerAbi, simProvider);
      await simContract.depositForBurn.staticCall(...burnArgs, { from: signerAddress });
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
    console.warn("[bridge] Burn simulation inconclusive — all RPCs unreachable. Proceeding.");
  }

  // ── Step 2: Transfer fee ───────────────────────────────────────────────
  let feeTxHash: string | undefined;
  if (fee.active) {
    onStatusChange({
      step: "collecting",
      message: `Collecting protocol fee (${fee.feeBps / 100}%)...`,
    });
    const feeTx = await usdc.transfer(fee.feeRecipient, fee.feeAmount, writeOverrides);
    onStatusChange({
      step: "collecting",
      message: `Fee of ${formatUsdc(fee.feeAmount)} USDC submitted...`,
      feeTxHash: feeTx.hash,
    });
    const feeReceipt = await waitWithRetry(feeTx, fromChain);
    if (!feeReceipt) throw new Error("Fee transaction was not confirmed. Please try again.");
    feeTxHash = feeReceipt.hash;
  }

  // ── Step 3: depositForBurn ─────────────────────────────────────────────
  onStatusChange({ step: "burning", message: "Initiating cross-chain transfer...", feeTxHash });

  // CCTP V2 (Arc Testnet) requires three extra parameters:
  //   destinationCaller = bytes32(0) → anyone may relay
  //   maxFee            = 0          → no premium for fast finality
  //   minFinalityThreshold           → per-chain setting
  const burnTx = isV2
    ? await tokenMessenger.depositForBurn(
        fee.bridgeAmount,
        toChain.cctpDomain,
        mintRecipient32,
        fromChain.usdcAddress,
        ethers.ZeroHash,     // destinationCaller = 0 (anyone)
        0n,                  // maxFee = 0
        finalityThreshold,
        writeOverrides
      )
    : await tokenMessenger.depositForBurn(
        fee.bridgeAmount,
        toChain.cctpDomain,
        mintRecipient32,
        fromChain.usdcAddress,
        writeOverrides
      );

  onStatusChange({
    step: "burning",
    message: "Burn transaction submitted, waiting for confirmation...",
    feeTxHash,
    burnTxHash: burnTx.hash,
  });

  const burnReceipt = await waitWithRetry(burnTx, fromChain);
  if (!burnReceipt) {
    throw new Error("Burn transaction was not confirmed. Please check the explorer and try again.");
  }

  const messageBytes = parseMessageSent(burnReceipt);
  return { burnTxHash: burnReceipt.hash, feeTxHash, messageBytes };
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
  if (fromChain.id === toChain.id) {
    throw new Error("Source and destination chains must be different.");
  }
  if (!ethers.isAddress(recipientAddress)) {
    throw new Error(`Invalid recipient address: ${recipientAddress}`);
  }

  const grossAmountInUnits = validateAmount(amount);
  const fee = calculateFee(grossAmountInUnits);
  if (fee.active && fee.bridgeAmount <= 0n) {
    throw new Error("Amount is too small to cover the bridge fee.");
  }

  const currentChainId = await getWalletChainId();
  if (currentChainId !== fromChain.id) {
    throw new Error(`Wallet is on the wrong network. Please switch to ${fromChain.name} first.`);
  }

  const provider      = await getProvider();
  const signer        = await provider.getSigner();
  const signerAddress = await signer.getAddress();

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

  const useGasRelay = !!(options?.useGasRelay && toChain.gasRelayerAddress);
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

  // ── Attest ────────────────────────────────────────────────────────────
  onStatusChange({
    step: "attesting",
    message: messageBytes
      ? "Burn confirmed. Fetching Circle attestation via message hash…"
      : "Burn confirmed. Requesting attestation from Circle...",
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

    // Poll for the relay tx receipt on the destination chain
    const destProvider = new ethers.JsonRpcProvider(toChain.rpcUrl);
    let relayReceipt: ethers.TransactionReceipt | null = null;
    for (let i = 0; i < 60; i++) {
      relayReceipt = await destProvider.getTransactionReceipt(relayTxHash);
      if (relayReceipt) break;
      await new Promise((r) => setTimeout(r, 5000));
    }
    if (!relayReceipt) {
      throw new Error(
        `Relay transaction submitted (${relayTxHash}) but not yet confirmed. ` +
        `Check ${toChain.explorerUrl}/tx/${relayTxHash} — your USDC will arrive once it confirms.`
      );
    }

    const netAmount = formatUsdc(fee.bridgeAmount - GAS_RELAY_FEE_UNITS);
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

    const destProvider = await getProvider();
    const destSigner   = await destProvider.getSigner();

    // Nonce replay check — message may have been minted in a previous attempt
    const alreadyMinted = await checkNonceUsed(attestationResult.message, toChain, destSigner);
    if (alreadyMinted) {
      const receivedAmount = formatUsdc(fee.bridgeAmount);
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

    const mintOverrides = toChain.gasLimitOverride ? { gasLimit: toChain.gasLimitOverride } : {};
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

    const receivedAmount = formatUsdc(fee.bridgeAmount);
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
  onStatusChange: (status: BridgeStatus) => void
): Promise<void> {
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

  const destProvider = await getProvider();
  const destSigner   = await destProvider.getSigner();

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

  // Apply gas override on chains where eth_estimateGas is unreliable (e.g. Arc Testnet as destination).
  const mintOverrides = toChain.gasLimitOverride ? { gasLimit: toChain.gasLimitOverride } : {};
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
