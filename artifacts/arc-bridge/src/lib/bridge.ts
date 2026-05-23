import { ethers } from "ethers";
import {
  ChainConfig,
  USDC_ABI,
  TOKEN_MESSENGER_ABI,
  MESSAGE_TRANSMITTER_ABI,
  ATTESTATION_API,
} from "./chains";
import { calculateFee, formatUsdc } from "./config";
import { FEE_ROUTER_ABI, getFeeRouterAddress } from "@/contracts/FeeRouterABI";

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
  return (accounts as string[])[0];
}

export async function getWalletChainId(): Promise<number> {
  if (!window.ethereum) throw new Error("No wallet detected.");
  const hexId = (await window.ethereum.request({ method: "eth_chainId" })) as string;
  return parseInt(hexId, 16);
}

export async function switchToChain(chain: ChainConfig): Promise<void> {
  if (!window.ethereum) throw new Error("No wallet detected.");
  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: chain.hexId }],
    });
  } catch (err: unknown) {
    const switchError = err as { code?: number };
    if (switchError.code === 4902) {
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: chain.hexId,
            chainName: chain.name,
            nativeCurrency: chain.nativeCurrency,
            rpcUrls: [chain.rpcUrl],
            blockExplorerUrls: [chain.explorerUrl],
          },
        ],
      });
      try {
        await window.ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: chain.hexId }],
        });
      } catch {
        // wallet_addEthereumChain may have already switched
      }
    } else {
      throw err;
    }
  }
}

/** Normalise any thrown error into a clean, user-facing message. */
export function friendlyError(err: unknown): string {
  const msg = (err as Error)?.message ?? String(err);

  // MetaMask / EIP-1193 user rejection
  if (
    msg.includes("user rejected") ||
    msg.includes("User denied") ||
    msg.includes("ACTION_REJECTED") ||
    (err as { code?: unknown })?.code === 4001
  ) {
    return "Transaction cancelled — you rejected the request in your wallet.";
  }

  // Insufficient funds for gas
  if (msg.includes("insufficient funds")) {
    return "Insufficient funds for gas. Add native tokens (ETH / AVAX / etc.) to your wallet.";
  }

  // Network / RPC errors
  if (msg.includes("network") || msg.includes("could not detect")) {
    return "Network error — check your internet connection and try again.";
  }

  // Return the first line only (ethers wraps long messages with newlines)
  return msg.split("\n")[0];
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

export async function getUsdcBalance(address: string, chain: ChainConfig): Promise<string> {
  try {
    const provider = new ethers.JsonRpcProvider(chain.rpcUrl);
    const usdc     = new ethers.Contract(chain.usdcAddress, USDC_ABI, provider);
    const balance  = await usdc.balanceOf(address);
    return ethers.formatUnits(balance, 6);
  } catch {
    return "0.000000";
  }
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

type AttestationMessage = {
  attestation?: string;
  message?: string;
  status?: string;
  eventNonce?: string;
};

async function fetchAttestation(
  sourceDomain: number,
  burnTxHash: string
): Promise<AttestationMessage[] | null> {
  // Try v2 first, then fall back to v1 — some chains/environments use different versions
  const endpoints = [
    `${ATTESTATION_API}/v2/messages/${sourceDomain}?transactionHash=${burnTxHash}`,
    `${ATTESTATION_API}/v1/messages/${sourceDomain}/${burnTxHash}`,
  ];
  for (const url of endpoints) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const data = await res.json();
      const msgs: AttestationMessage[] = data?.messages ?? [];
      if (msgs.length > 0) return msgs;
    } catch {
      // try next endpoint
    }
  }
  return null;
}

async function pollAttestation(
  sourceDomain: number,
  burnTxHash: string,
  onProgress: (msg: string) => void
): Promise<{ message: string; attestation: string }> {
  onProgress("Waiting for Circle attestation (this can take a few minutes on testnet)...");

  // 240 attempts × 5 s = 20 minutes total
  for (let i = 0; i < 240; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    try {
      const messages = await fetchAttestation(sourceDomain, burnTxHash);

      if (!messages) {
        onProgress(`Waiting for attestation... (${i + 1}/240, no response yet)`);
        continue;
      }

      const complete = messages.find(
        (m) => m.attestation && m.attestation !== "PENDING" && m.message
      );
      if (complete?.attestation && complete?.message) {
        return { message: complete.message, attestation: complete.attestation };
      }

      // Show the actual status returned so the user can see progress
      const status = messages[0]?.status ?? messages[0]?.attestation ?? "pending";
      const elapsed = Math.floor(((i + 1) * 5) / 60);
      const elapsedStr = elapsed > 0 ? ` · ${elapsed}m elapsed` : "";
      onProgress(`Attestation status: ${status}${elapsedStr} (${i + 1}/240)`);
    } catch {
      onProgress(`Polling error, retrying... (${i + 1}/240)`);
    }
  }

  throw new Error(
    `Attestation timed out after 20 minutes. Your funds are safe — the burn is confirmed.\n` +
    `Burn tx: ${burnTxHash}\n` +
    `You can manually complete the mint later using the CCTP relayer at https://developers.circle.com/stablecoins/cctp-getting-started`
  );
}

// ── Smart-contract path: single FeeRouter.bridge() call ───────────────────

async function burnViaFeeRouter(
  fromChain: ChainConfig,
  toChain: ChainConfig,
  grossAmountInUnits: bigint,
  mintRecipient: string,
  signer: ethers.Signer,
  signerAddress: string,
  feeRouterAddress: string,
  onStatusChange: (status: BridgeStatus) => void
): Promise<{ burnTxHash: string; feeTxHash?: string }> {
  const usdc          = new ethers.Contract(fromChain.usdcAddress, USDC_ABI, signer);
  const mintRecipient32 = addressToBytes32(mintRecipient);

  // ── Step 1: Approve FeeRouter for the gross amount ─────────────────────
  onStatusChange({ step: "approving", message: "Checking USDC allowance for FeeRouter..." });

  const allowance: bigint = await usdc.allowance(signerAddress, feeRouterAddress);
  if (allowance < grossAmountInUnits) {
    const approveTx = await usdc.approve(feeRouterAddress, grossAmountInUnits);
    onStatusChange({
      step: "approving",
      message: "Approval submitted, waiting for confirmation...",
      txHash: approveTx.hash,
    });
    const approveReceipt = await approveTx.wait();
    if (!approveReceipt) throw new Error("Approval transaction was not confirmed. Please try again.");
  } else {
    onStatusChange({ step: "approving", message: "Allowance sufficient, skipping approval." });
  }

  // ── Step 2: FeeRouter.bridge() — fee + burn in one tx ─────────────────
  onStatusChange({
    step: "collecting",
    message: "Sending bridge transaction (fee collected + burn in one step)...",
  });

  const feeRouter = new ethers.Contract(feeRouterAddress, FEE_ROUTER_ABI, signer);
  const bridgeTx  = await feeRouter.bridge(
    grossAmountInUnits,
    toChain.cctpDomain,
    mintRecipient32,
    fromChain.usdcAddress,
    fromChain.tokenMessenger
  );

  onStatusChange({
    step: "burning",
    message: "Bridge transaction submitted, waiting for confirmation...",
    burnTxHash: bridgeTx.hash,
  });

  const bridgeReceipt = await bridgeTx.wait();
  if (!bridgeReceipt) {
    throw new Error("Bridge transaction was not confirmed. Please check the explorer and try again.");
  }

  return { burnTxHash: bridgeReceipt.hash };
}

// ── Fallback path: manual approve → transfer fee → depositForBurn ──────────

async function burnWithManualFee(
  fromChain: ChainConfig,
  toChain: ChainConfig,
  grossAmountInUnits: bigint,
  mintRecipient: string,
  signer: ethers.Signer,
  signerAddress: string,
  onStatusChange: (status: BridgeStatus) => void
): Promise<{ burnTxHash: string; feeTxHash?: string }> {
  const fee           = calculateFee(grossAmountInUnits);
  const mintRecipient32 = addressToBytes32(mintRecipient);
  const usdc          = new ethers.Contract(fromChain.usdcAddress, USDC_ABI, signer);

  // ── Step 1: Approve TokenMessenger for bridge amount only ──────────────
  onStatusChange({ step: "approving", message: "Checking USDC allowance..." });

  const allowance: bigint = await usdc.allowance(signerAddress, fromChain.tokenMessenger);
  if (allowance < fee.bridgeAmount) {
    const approveTx = await usdc.approve(fromChain.tokenMessenger, fee.bridgeAmount);
    onStatusChange({
      step: "approving",
      message: "Approval submitted, waiting for confirmation...",
      txHash: approveTx.hash,
    });
    const approveReceipt = await approveTx.wait();
    if (!approveReceipt) throw new Error("Approval transaction was not confirmed. Please try again.");
  } else {
    onStatusChange({ step: "approving", message: "Allowance sufficient, skipping approval." });
  }

  // ── Step 2: Transfer fee ───────────────────────────────────────────────
  let feeTxHash: string | undefined;
  if (fee.active) {
    onStatusChange({
      step: "collecting",
      message: `Collecting protocol fee (${fee.feeBps / 100}%)...`,
    });
    const feeTx = await usdc.transfer(fee.feeRecipient, fee.feeAmount);
    onStatusChange({
      step: "collecting",
      message: `Fee of ${formatUsdc(fee.feeAmount)} USDC submitted...`,
      feeTxHash: feeTx.hash,
    });
    const feeReceipt = await feeTx.wait();
    if (!feeReceipt) throw new Error("Fee transaction was not confirmed. Please try again.");
    feeTxHash = feeReceipt.hash;
  }

  // ── Step 3: depositForBurn ─────────────────────────────────────────────
  onStatusChange({ step: "burning", message: "Initiating cross-chain transfer...", feeTxHash });

  const tokenMessenger = new ethers.Contract(fromChain.tokenMessenger, TOKEN_MESSENGER_ABI, signer);
  const burnTx = await tokenMessenger.depositForBurn(
    fee.bridgeAmount,
    toChain.cctpDomain,
    mintRecipient32,
    fromChain.usdcAddress
  );

  onStatusChange({
    step: "burning",
    message: "Burn transaction submitted, waiting for confirmation...",
    feeTxHash,
    burnTxHash: burnTx.hash,
  });

  const burnReceipt = await burnTx.wait();
  if (!burnReceipt) {
    throw new Error("Burn transaction was not confirmed. Please check the explorer and try again.");
  }

  return { burnTxHash: burnReceipt.hash, feeTxHash };
}

// ── Main entry point ────────────────────────────────────────────────────────

export async function executeBridge(
  fromChain: ChainConfig,
  toChain: ChainConfig,
  amount: string,
  recipientAddress: string,
  onStatusChange: (status: BridgeStatus) => void
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

  // Choose burn path: FeeRouter contract (preferred) or manual fallback
  const feeRouterAddress = getFeeRouterAddress(fromChain.id);
  let burnTxHash: string;
  let feeTxHash: string | undefined;

  if (feeRouterAddress) {
    // ── Smart contract path ──────────────────────────────────────────────
    const result = await burnViaFeeRouter(
      fromChain, toChain, grossAmountInUnits, recipientAddress,
      signer, signerAddress, feeRouterAddress, onStatusChange
    );
    burnTxHash = result.burnTxHash;
  } else {
    // ── Manual fallback path ─────────────────────────────────────────────
    const result = await burnWithManualFee(
      fromChain, toChain, grossAmountInUnits, recipientAddress,
      signer, signerAddress, onStatusChange
    );
    burnTxHash = result.burnTxHash;
    feeTxHash  = result.feeTxHash;
  }

  // ── Attest ────────────────────────────────────────────────────────────
  onStatusChange({
    step: "attesting",
    message: "Burn confirmed. Requesting attestation from Circle...",
    feeTxHash,
    burnTxHash,
  });

  const attestationResult = await pollAttestation(
    fromChain.cctpDomain,
    burnTxHash,
    (msg) => onStatusChange({ step: "attesting", message: msg, feeTxHash, burnTxHash })
  );

  // ── Switch + Mint ──────────────────────────────────────────────────────
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

  const messageTransmitter = new ethers.Contract(
    toChain.messageTransmitter,
    MESSAGE_TRANSMITTER_ABI,
    destSigner
  );

  onStatusChange({ step: "minting", message: "Minting USDC on destination chain...", feeTxHash, burnTxHash });

  const mintTx = await messageTransmitter.receiveMessage(
    attestationResult.message,
    attestationResult.attestation
  );

  onStatusChange({
    step: "minting",
    message: "Mint transaction submitted, waiting for confirmation...",
    feeTxHash,
    burnTxHash,
    mintTxHash: mintTx.hash,
  });

  const mintReceipt = await mintTx.wait();
  if (!mintReceipt) {
    throw new Error(
      "Mint transaction was not confirmed. Your funds are safe — the attestation is still valid. Check the explorer and retry the mint."
    );
  }

  const receivedAmount = formatUsdc(fee.bridgeAmount);
  onStatusChange({
    step: "done",
    message: `Bridge complete! ${receivedAmount} USDC has arrived on ${toChain.name}.`,
    feeTxHash,
    burnTxHash,
    mintTxHash: mintReceipt.hash,
  });
}
