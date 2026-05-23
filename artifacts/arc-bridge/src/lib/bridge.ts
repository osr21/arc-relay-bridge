import { ethers } from "ethers";
import {
  ChainConfig,
  USDC_ABI,
  TOKEN_MESSENGER_ABI,
  MESSAGE_TRANSMITTER_ABI,
  ATTESTATION_API,
} from "./chains";

export type BridgeStep =
  | "idle"
  | "approving"
  | "burning"
  | "attesting"
  | "minting"
  | "done"
  | "error";

export type ActiveStep = "approving" | "burning" | "attesting" | "minting";

export interface BridgeStatus {
  step: BridgeStep;
  message: string;
  txHash?: string;
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
  const hexId = await window.ethereum.request({ method: "eth_chainId" }) as string;
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
      // After adding, explicitly switch (some wallets require this)
      try {
        await window.ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: chain.hexId }],
        });
      } catch {
        // Ignore — wallet_addEthereumChain may have already switched
      }
    } else {
      throw err;
    }
  }
}

/** Poll until the wallet chain matches expectedChainId, or timeout. */
async function waitForChainSwitch(expectedChainId: number, timeoutMs = 30000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 600));
    const current = await getWalletChainId();
    if (current === expectedChainId) return;
  }
  throw new Error(
    "Chain switch timed out. Please switch networks manually and try again."
  );
}

export async function getUsdcBalance(
  address: string,
  chain: ChainConfig
): Promise<string> {
  try {
    const provider = new ethers.JsonRpcProvider(chain.rpcUrl);
    const usdc = new ethers.Contract(chain.usdcAddress, USDC_ABI, provider);
    const balance = await usdc.balanceOf(address);
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
  if (!amount || amount.trim() === "") {
    throw new Error("Please enter an amount.");
  }
  const trimmed = amount.trim();
  const parts = trimmed.split(".");
  if (parts[1] && parts[1].length > 6) {
    throw new Error("Amount cannot have more than 6 decimal places (USDC has 6 decimals).");
  }
  let parsed: bigint;
  try {
    parsed = ethers.parseUnits(trimmed, 6);
  } catch {
    throw new Error("Invalid amount entered.");
  }
  if (parsed <= 0n) {
    throw new Error("Amount must be greater than zero.");
  }
  return parsed;
}

async function pollAttestation(
  sourceDomain: number,
  burnTxHash: string,
  onProgress: (msg: string) => void
): Promise<{ message: string; attestation: string }> {
  const url = `${ATTESTATION_API}/v2/messages/${sourceDomain}?transactionHash=${burnTxHash}`;
  onProgress("Waiting for Circle attestation (this may take 1–3 minutes)...");

  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    try {
      const res = await fetch(url);
      if (!res.ok) {
        onProgress(`Polling attestation... (attempt ${i + 1}/120)`);
        continue;
      }
      const data = await res.json();
      const messages: Array<{ attestation?: string; message?: string; status?: string }> =
        data?.messages ?? [];
      const found = messages.find(
        (m) => m.attestation && m.attestation !== "PENDING" && m.message
      );
      if (found?.attestation && found?.message) {
        return { message: found.message, attestation: found.attestation };
      }
      onProgress(`Waiting for attestation... (attempt ${i + 1}/120)`);
    } catch {
      onProgress(`Polling error, retrying... (attempt ${i + 1}/120)`);
    }
  }
  throw new Error("Attestation timed out after 10 minutes.");
}

export async function executeBridge(
  fromChain: ChainConfig,
  toChain: ChainConfig,
  amount: string,
  recipientAddress: string,
  onStatusChange: (status: BridgeStatus) => void
): Promise<void> {
  // Pre-flight validation
  if (fromChain.id === toChain.id) {
    throw new Error("Source and destination chains must be different.");
  }
  if (!ethers.isAddress(recipientAddress)) {
    throw new Error(`Invalid recipient address: ${recipientAddress}`);
  }
  const amountInUnits = validateAmount(amount);

  // Verify wallet is on the source chain
  const currentChainId = await getWalletChainId();
  if (currentChainId !== fromChain.id) {
    throw new Error(
      `Wallet is on the wrong network. Please switch to ${fromChain.name} first.`
    );
  }

  const provider = await getProvider();
  const signer = await provider.getSigner();
  const signerAddress = await signer.getAddress();

  // Step 1: Approve
  onStatusChange({ step: "approving", message: "Checking USDC allowance..." });

  const usdc = new ethers.Contract(fromChain.usdcAddress, USDC_ABI, signer);
  const currentAllowance: bigint = await usdc.allowance(
    signerAddress,
    fromChain.tokenMessenger
  );

  if (currentAllowance < amountInUnits) {
    const approveTx = await usdc.approve(fromChain.tokenMessenger, amountInUnits);
    onStatusChange({
      step: "approving",
      message: "Approval submitted, waiting for confirmation...",
      txHash: approveTx.hash,
    });
    const approveReceipt = await approveTx.wait();
    if (!approveReceipt) {
      throw new Error("Approval transaction was not confirmed. Please try again.");
    }
  } else {
    onStatusChange({ step: "approving", message: "Allowance already sufficient, skipping approval." });
  }

  // Step 2: Burn (depositForBurn)
  onStatusChange({ step: "burning", message: "Initiating cross-chain transfer..." });

  const tokenMessenger = new ethers.Contract(
    fromChain.tokenMessenger,
    TOKEN_MESSENGER_ABI,
    signer
  );

  const mintRecipient = addressToBytes32(recipientAddress);
  const burnTx = await tokenMessenger.depositForBurn(
    amountInUnits,
    toChain.cctpDomain,
    mintRecipient,
    fromChain.usdcAddress
  );

  onStatusChange({
    step: "burning",
    message: "Burn transaction submitted, waiting for confirmation...",
    burnTxHash: burnTx.hash,
  });

  const burnReceipt = await burnTx.wait();
  if (!burnReceipt) {
    throw new Error("Burn transaction was not confirmed. Please check the explorer and try again.");
  }

  onStatusChange({
    step: "attesting",
    message: "Burn confirmed. Requesting attestation from Circle...",
    burnTxHash: burnReceipt.hash,
  });

  // Step 3: Poll for attestation
  const attestationResult = await pollAttestation(
    fromChain.cctpDomain,
    burnReceipt.hash,
    (msg) =>
      onStatusChange({
        step: "attesting",
        message: msg,
        burnTxHash: burnReceipt.hash,
      })
  );

  // Step 4: Switch to destination chain and mint
  onStatusChange({
    step: "minting",
    message: `Switching to ${toChain.name} to mint USDC...`,
    burnTxHash: burnReceipt.hash,
  });

  await switchToChain(toChain);
  await waitForChainSwitch(toChain.id);

  const destProvider = await getProvider();
  const destSigner = await destProvider.getSigner();

  const messageTransmitter = new ethers.Contract(
    toChain.messageTransmitter,
    MESSAGE_TRANSMITTER_ABI,
    destSigner
  );

  onStatusChange({
    step: "minting",
    message: "Minting USDC on destination chain...",
    burnTxHash: burnReceipt.hash,
  });

  const mintTx = await messageTransmitter.receiveMessage(
    attestationResult.message,
    attestationResult.attestation
  );

  onStatusChange({
    step: "minting",
    message: "Mint transaction submitted, waiting for confirmation...",
    burnTxHash: burnReceipt.hash,
    mintTxHash: mintTx.hash,
  });

  const mintReceipt = await mintTx.wait();
  if (!mintReceipt) {
    throw new Error("Mint transaction was not confirmed. Your funds are safe — the attestation is still valid. Check the explorer and retry the mint.");
  }

  onStatusChange({
    step: "done",
    message: `Bridge complete! ${amount} USDC has arrived on ${toChain.name}.`,
    burnTxHash: burnReceipt.hash,
    mintTxHash: mintReceipt.hash,
  });
}
