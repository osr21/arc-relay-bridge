import { Router, type IRouter } from "express";
import { ethers } from "ethers";

const router: IRouter = Router();

// ── Chain configs ─────────────────────────────────────────────────────────────
// Must stay in sync with artifacts/arc-bridge/src/lib/chains.ts

const CHAIN_CONFIGS: Record<number, {
  name: string;
  rpcUrl: string;
  rpcFallbacks: string[];
  gasRelayerAddress: string;
  gasLimitOverride?: bigint;
}> = {
  5042002: {
    name: "Arc Testnet",
    rpcUrl: "https://rpc.drpc.testnet.arc.network",
    rpcFallbacks: ["https://rpc.testnet.arc.network"],
    gasRelayerAddress: "0x837D9a19C07bb7B4E95071dC0BaED72D4dE04ea1",
    gasLimitOverride: 600_000n,
  },
  11155111: {
    name: "Ethereum Sepolia",
    rpcUrl: "https://ethereum-sepolia-rpc.publicnode.com",
    rpcFallbacks: ["https://sepolia.drpc.org", "https://1rpc.io/sepolia"],
    gasRelayerAddress: "0x5E87F210043D8457caCAd0F0c9aB70a99497Eec9",
  },
  84532: {
    name: "Base Sepolia",
    rpcUrl: "https://sepolia.base.org",
    rpcFallbacks: ["https://base-sepolia.drpc.org", "https://base-sepolia-rpc.publicnode.com"],
    gasRelayerAddress: "0x64D160b7E91e78e52dFc0e8829640E32A919164C",
  },
  43113: {
    name: "Avalanche Fuji",
    rpcUrl: "https://api.avax-test.network/ext/bc/C/rpc",
    rpcFallbacks: ["https://avalanche-fuji.drpc.org"],
    gasRelayerAddress: "0x6F80056564491425273A6a481EcC5DAea9D57f23",
  },
};

const GAS_RELAYER_ABI = [
  "function relay(bytes calldata message, bytes calldata attestation, address recipient, uint256 maxFee) external",
  "function relayFee() view returns (uint256)",
  "function paused() view returns (bool)",
];

// Max relay fee we'll accept in a request — 5 USDC (5_000_000 units)
const MAX_ACCEPTABLE_FEE = 5_000_000n;

async function getProvider(chain: typeof CHAIN_CONFIGS[number]): Promise<ethers.JsonRpcProvider> {
  const urls = [chain.rpcUrl, ...chain.rpcFallbacks];
  let lastErr: unknown;
  for (const url of urls) {
    try {
      const p = new ethers.JsonRpcProvider(url);
      await p.getBlockNumber();
      return p;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr ?? new Error("All RPCs failed");
}

/**
 * POST /api/relay
 *
 * Submits a GasRelayer.relay() transaction on behalf of the user.
 * The user burned USDC with mintRecipient = GasRelayer contract, so the contract
 * receives the minted USDC and forwards (amount - relayFee) to `recipient`.
 *
 * Body:
 *   message      — 0x-prefixed hex bytes from the CCTP MessageSent event
 *   attestation  — 0x-prefixed hex attestation from Circle Iris
 *   recipient    — user wallet address on the destination chain
 *   destChainId  — destination chain ID (number)
 *   maxFee       — maximum relay fee in USDC units (string, 6 decimals)
 *
 * Returns:
 *   { txHash, relayFee, chain }  on success
 *   { error }                    on failure
 */
/**
 * GET /api/relay/fee?chainId=<number>
 *
 * Returns the current relay fee for the specified destination chain,
 * read live from the on-chain GasRelayer contract.
 *
 * Response: { chainId, relayFee, chain }
 */
router.get("/relay/fee", async (req, res) => {
  const { chainId } = req.query;

  if (!chainId || typeof chainId !== "string" || !/^\d+$/.test(chainId)) {
    res.status(400).json({ error: "Missing or invalid chainId query parameter" });
    return;
  }

  const id    = parseInt(chainId, 10);
  const chain = CHAIN_CONFIGS[id];
  if (!chain) {
    res.status(400).json({ error: `Unsupported chainId: ${id}` });
    return;
  }

  let provider: ethers.JsonRpcProvider;
  try {
    provider = await getProvider(chain);
  } catch {
    res.status(503).json({ error: `Cannot connect to ${chain.name} RPC` });
    return;
  }

  try {
    const contract = new ethers.Contract(chain.gasRelayerAddress, GAS_RELAYER_ABI, provider);
    const fee      = await contract.relayFee() as bigint;
    res.json({ chainId: id, relayFee: fee.toString(), chain: chain.name });
  } catch {
    res.status(503).json({ error: `Failed to read relay fee from ${chain.name}` });
  }
});

router.post("/relay", async (req, res) => {
  const { message, attestation, recipient, destChainId, maxFee } = req.body ?? {};

  // ── Input validation ──────────────────────────────────────────────────────
  if (!message || typeof message !== "string" || !/^0x[0-9a-fA-F]+$/.test(message)) {
    res.status(400).json({ error: "Invalid message — must be 0x-prefixed hex" });
    return;
  }
  if (!attestation || typeof attestation !== "string" || !/^0x[0-9a-fA-F]+$/.test(attestation)) {
    res.status(400).json({ error: "Invalid attestation — must be 0x-prefixed hex" });
    return;
  }
  if (!recipient || !ethers.isAddress(recipient)) {
    res.status(400).json({ error: "Invalid recipient address" });
    return;
  }
  if (!destChainId || typeof destChainId !== "number" || !Number.isInteger(destChainId)) {
    res.status(400).json({ error: "Invalid destChainId — must be an integer" });
    return;
  }
  if (!maxFee || typeof maxFee !== "string" || !/^\d+$/.test(maxFee)) {
    res.status(400).json({ error: "Invalid maxFee — must be a decimal string of USDC units" });
    return;
  }

  const maxFeeBig = BigInt(maxFee);
  if (maxFeeBig > MAX_ACCEPTABLE_FEE) {
    res.status(400).json({ error: `maxFee exceeds server limit of ${MAX_ACCEPTABLE_FEE} units` });
    return;
  }

  const chain = CHAIN_CONFIGS[destChainId];
  if (!chain) {
    res.status(400).json({ error: `Unsupported destChainId: ${destChainId}` });
    return;
  }

  const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
  if (!privateKey) {
    res.status(503).json({ error: "Relay service is not configured (no deployer key)" });
    return;
  }

  // ── Submit relay tx ───────────────────────────────────────────────────────
  let provider: ethers.JsonRpcProvider;
  try {
    provider = await getProvider(chain);
  } catch {
    res.status(503).json({ error: `Cannot connect to ${chain.name} RPC` });
    return;
  }

  const wallet   = new ethers.Wallet(privateKey, provider);
  const contract = new ethers.Contract(chain.gasRelayerAddress, GAS_RELAYER_ABI, wallet);

  let relayFeeOnChain: bigint;
  try {
    relayFeeOnChain = await contract.relayFee() as bigint;
  } catch {
    res.status(503).json({ error: "Failed to read relay fee from contract" });
    return;
  }

  if (relayFeeOnChain > maxFeeBig) {
    res.status(400).json({
      error: `Current relay fee (${relayFeeOnChain.toString()} units) exceeds your maxFee (${maxFee} units)`,
    });
    return;
  }

  const overrides: Record<string, bigint> = {};
  if (chain.gasLimitOverride) overrides.gasLimit = chain.gasLimitOverride;

  let txHash: string;
  try {
    const tx = await contract.relay(message, attestation, recipient, maxFeeBig, overrides);
    txHash = tx.hash;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const reason = (err as { reason?: string })?.reason;
    res.status(500).json({
      error: `Relay transaction failed: ${reason ?? msg.slice(0, 200)}`,
    });
    return;
  }

  res.json({
    txHash,
    relayFee: relayFeeOnChain.toString(),
    chain: chain.name,
  });
});

export default router;
