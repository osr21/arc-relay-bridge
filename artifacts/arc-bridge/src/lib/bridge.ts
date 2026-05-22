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

export interface BridgeStatus {
  step: BridgeStep;
  message: string;
  txHash?: string;
  burnTxHash?: string;
  mintTxHash?: string;
  error?: string;
}

declare global {
  interface Window {
    ethereum?: ethers.Eip1193Provider & {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
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
  const provider = await getProvider();
  const network = await provider.getNetwork();
  return Number(network.chainId);
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
    } else {
      throw err;
    }
  }
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
    return "0.00";
  }
}

function addressToBytes32(address: string): string {
  return ethers.zeroPadValue(address, 32);
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
        onProgress(`Polling attestation... (attempt ${i + 1})`);
        continue;
      }
      const data = await res.json();
      const messages: Array<{ attestation?: string; message?: string; status?: string }> =
        data?.messages ?? [];
      const found = messages.find((m) => m.attestation && m.attestation !== "PENDING");
      if (found?.attestation && found?.message) {
        return { message: found.message, attestation: found.attestation };
      }
      onProgress(`Waiting for attestation... (attempt ${i + 1}/120)`);
    } catch {
      onProgress(`Polling error, retrying... (attempt ${i + 1})`);
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
  const provider = await getProvider();
  const signer = await provider.getSigner();
  const signerAddress = await signer.getAddress();

  const amountInUnits = ethers.parseUnits(amount, 6);

  // Step 1: Approve
  onStatusChange({ step: "approving", message: "Approving USDC spend..." });

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
    await approveTx.wait();
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
  onStatusChange({
    step: "attesting",
    message: "Burn confirmed. Requesting attestation from Circle...",
    burnTxHash: burnReceipt.hash,
  });

  // Step 3: Poll for attestation
  let attestationResult: { message: string; attestation: string };
  try {
    attestationResult = await pollAttestation(
      fromChain.cctpDomain,
      burnReceipt.hash,
      (msg) =>
        onStatusChange({
          step: "attesting",
          message: msg,
          burnTxHash: burnReceipt.hash,
        })
    );
  } catch (err: unknown) {
    throw new Error((err as Error).message);
  }

  // Step 4: Mint on destination chain
  onStatusChange({
    step: "minting",
    message: `Switching to ${toChain.name} to mint USDC...`,
    burnTxHash: burnReceipt.hash,
  });

  await switchToChain(toChain);
  await new Promise((r) => setTimeout(r, 1000));

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

  onStatusChange({
    step: "done",
    message: `Bridge complete! ${amount} USDC has arrived on ${toChain.name}.`,
    burnTxHash: burnReceipt.hash,
    mintTxHash: mintReceipt.hash,
  });
}
