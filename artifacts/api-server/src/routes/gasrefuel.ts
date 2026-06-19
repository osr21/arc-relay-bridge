import { Router, type IRouter } from "express";
import { ethers } from "ethers";

const router: IRouter = Router();

// ── Arc source chain ──────────────────────────────────────────────────────────
const ARC_RPC_URLS = [
  "https://rpc.drpc.testnet.arc.network",
  "https://rpc.testnet.arc.network",
];
const ARC_USDC = "0x3600000000000000000000000000000000000000";

const USDC_TRANSFER_ABI = [
  "event Transfer(address indexed from, address indexed to, uint256 value)",
];

// ── Destination chains ────────────────────────────────────────────────────────
interface DestChain {
  name: string;
  shortName: string;
  symbol: string;
  rpcUrls: string[];
  bandSymbol: string;
  explorerUrl: string;
}

const DEST_CHAINS: Record<number, DestChain> = {
  11155111: {
    name: "Ethereum Sepolia",
    shortName: "Sepolia",
    symbol: "ETH",
    rpcUrls: [
      "https://ethereum-sepolia-rpc.publicnode.com",
      "https://sepolia.drpc.org",
      "https://1rpc.io/sepolia",
    ],
    bandSymbol: "ETH",
    explorerUrl: "https://sepolia.etherscan.io",
  },
  84532: {
    name: "Base Sepolia",
    shortName: "Base",
    symbol: "ETH",
    rpcUrls: [
      "https://sepolia.base.org",
      "https://base-sepolia.drpc.org",
      "https://base-sepolia-rpc.publicnode.com",
    ],
    bandSymbol: "ETH",
    explorerUrl: "https://sepolia.basescan.org",
  },
  43113: {
    name: "Avalanche Fuji",
    shortName: "Fuji",
    symbol: "AVAX",
    rpcUrls: [
      "https://api.avax-test.network/ext/bc/C/rpc",
      "https://avalanche-fuji.drpc.org",
    ],
    bandSymbol: "AVAX",
    explorerUrl: "https://testnet.snowtrace.io",
  },
};

// ── Limits ────────────────────────────────────────────────────────────────────
const SERVICE_FEE_BPS = 500n;      // 5% — covers relayer gas costs
const MIN_USDC = 500_000n;         // 0.5 USDC
const MAX_USDC = 10_000_000n;      // 10 USDC

// ── Replay protection (in-memory; resets on restart — acceptable for testnet) ─
// usedArcTxHashes  — permanently fulfilled; blocks all future replays
// pendingArcTxHashes — currently in-flight; blocks concurrent duplicates
//   (prevents race-condition double-spend: two concurrent requests with the
//    same arcTxHash both passing the used-check before either marks it used)
const usedArcTxHashes = new Set<string>();
const pendingArcTxHashes = new Set<string>();

// ── Deployer address cache ─────────────────────────────────────────────────
// Derive once at first use rather than re-instantiating a Wallet on every request.
let _cachedDeployerAddress: string | null = null;
function getDeployerAddress(privateKey: string): string {
  if (!_cachedDeployerAddress) {
    _cachedDeployerAddress = new ethers.Wallet(privateKey).address;
  }
  return _cachedDeployerAddress;
}

// ── Price source: CoinGecko free /simple/price ───────────────────────────────
// Band oracle on Arc Testnet only has USDC/USD; ETH and AVAX are not available.
// CoinGecko's free endpoint requires no API key.
const GECKO_IDS: Record<string, string> = {
  ETH: "ethereum",
  AVAX: "avalanche-2",
};

// Hardcoded fallback prices (testnet only — exact value doesn't matter for testnet)
const FALLBACK_USD: Record<string, number> = {
  ETH: 3_500,
  AVAX: 30,
};

// ── Price cache ───────────────────────────────────────────────────────────────
const priceCache = new Map<string, { rate: bigint; fetchedAt: number }>();
const PRICE_CACHE_TTL = 60_000; // 60 s — longer TTL to reduce CoinGecko calls

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getRpcProvider(urls: string[]): Promise<ethers.JsonRpcProvider> {
  let lastErr: unknown;
  for (const url of urls) {
    try {
      const p = new ethers.JsonRpcProvider(url);
      await Promise.race([
        p.getBlockNumber(),
        new Promise<never>((_, rej) =>
          setTimeout(() => rej(new Error(`RPC timeout: ${url}`)), 6_000)
        ),
      ]);
      return p;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr ?? new Error("All RPCs failed");
}

/**
 * Returns a 1e18-scaled USD price for a native token symbol (ETH, AVAX).
 * Fetches from CoinGecko free API; falls back to hardcoded testnet defaults.
 *
 * 1e18-scaled means: $3600 ETH → 3600n * 10n**18n
 * This matches the Band oracle output format used in calcNativeWei().
 */
async function getNativePrice(symbol: string): Promise<bigint> {
  const now = Date.now();
  const cached = priceCache.get(symbol);
  if (cached && now - cached.fetchedAt < PRICE_CACHE_TTL) return cached.rate;

  const geckoId = GECKO_IDS[symbol];
  let usdPrice: number = FALLBACK_USD[symbol] ?? 1;

  if (geckoId) {
    try {
      const url = `https://api.coingecko.com/api/v3/simple/price?ids=${geckoId}&vs_currencies=usd`;
      const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
      if (res.ok) {
        const data = await res.json() as Record<string, { usd?: number }>;
        const fetched = data[geckoId]?.usd;
        if (fetched && fetched > 0) usdPrice = fetched;
      }
    } catch {
      // Network error — use fallback silently
    }
  }

  // Convert to 1e18-scaled bigint: $3600.50 → BigInt(3600500000) * 10n**9n
  // (split into two safe-integer multiplications to avoid precision loss)
  const rate = BigInt(Math.round(usdPrice * 1e6)) * 10n ** 12n;
  priceCache.set(symbol, { rate, fetchedAt: now });
  return rate;
}

/**
 * Native wei from USDC units.
 *
 * Price rate is 1e18-scaled USD per native token (e.g. ETH=$3600 → rate=3600×1e18).
 * USDC has 6 decimals.
 *
 *   nativeWei = (usdcUnits / 1e6) / (rate / 1e18) × 1e18
 *             = usdcUnits × 1e30 / rate          (gross, pre-fee)
 *             × (10000 - feeBps) / 10000          (after service fee)
 *
 * Verification (1 USDC, ETH at $3600, rate = 3600×1e18):
 *   1e6 × 1e30 / (3600×1e18) = 1e36 / 3.6e21 ≈ 2.78e14 wei ≈ 0.000278 ETH ✓
 */
function calcNativeWei(usdcUnits: bigint, nativeRate: bigint): bigint {
  return (usdcUnits * 10n ** 30n * (10000n - SERVICE_FEE_BPS)) / (nativeRate * 10000n);
}

// ── GET /api/gasrefuel/quote ──────────────────────────────────────────────────

router.get("/gasrefuel/quote", async (req, res) => {
  const { destChainId, usdcAmount } = req.query;

  if (!destChainId || typeof destChainId !== "string" || !/^\d+$/.test(destChainId)) {
    res.status(400).json({ error: "Invalid destChainId" });
    return;
  }
  if (!usdcAmount || typeof usdcAmount !== "string" || !/^\d+$/.test(usdcAmount)) {
    res.status(400).json({ error: "Invalid usdcAmount — decimal string of 6-decimal USDC units" });
    return;
  }

  const chainId = parseInt(destChainId, 10);
  const chain = DEST_CHAINS[chainId];
  if (!chain) {
    res.status(400).json({ error: `Unsupported destChainId: ${chainId}` });
    return;
  }

  const usdcBig = BigInt(usdcAmount);
  if (usdcBig < MIN_USDC || usdcBig > MAX_USDC) {
    res.status(400).json({
      error: `usdcAmount must be between ${MIN_USDC} (0.5 USDC) and ${MAX_USDC} (10 USDC) units`,
      min: MIN_USDC.toString(),
      max: MAX_USDC.toString(),
    });
    return;
  }

  const privateKey = process.env["DEPLOYER_PRIVATE_KEY"];
  if (!privateKey) {
    res.status(503).json({ error: "Refuel service not configured" });
    return;
  }

  try {
    const deployerAddress = getDeployerAddress(privateKey);

    const [nativeRate, destProvider] = await Promise.all([
      getNativePrice(chain.bandSymbol),
      getRpcProvider(chain.rpcUrls),
    ]);

    const nativeWei = calcNativeWei(usdcBig, nativeRate);
    const liquidity = await destProvider.getBalance(deployerAddress);

    res.json({
      destChainId: chainId,
      destChain: chain.name,
      nativeSymbol: chain.symbol,
      usdcAmount: usdcAmount,
      nativeAmount: nativeWei.toString(),
      nativeAmountFormatted: parseFloat(ethers.formatEther(nativeWei)).toFixed(8),
      nativeUsdRate: nativeRate.toString(),
      serviceFeePercent: (Number(SERVICE_FEE_BPS) / 100).toFixed(0),
      depositAddress: deployerAddress,
      liquidityAvailable: liquidity.toString(),
      liquidityFormatted: parseFloat(ethers.formatEther(liquidity)).toFixed(6),
      sufficient: liquidity >= nativeWei,
      validUntil: Date.now() + 2 * 60 * 1000,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message.slice(0, 120) : String(err).slice(0, 120);
    req.log.error({ err }, "gasrefuel quote error");
    res.status(503).json({ error: `Quote unavailable: ${msg}` });
  }
});

// ── GET /api/gasrefuel/liquidity ──────────────────────────────────────────────

router.get("/gasrefuel/liquidity", async (req, res) => {
  const privateKey = process.env["DEPLOYER_PRIVATE_KEY"];
  if (!privateKey) {
    res.status(503).json({ error: "Refuel service not configured" });
    return;
  }

  const deployerAddress = getDeployerAddress(privateKey);

  const results = await Promise.allSettled(
    Object.entries(DEST_CHAINS).map(async ([chainIdStr, chain]) => {
      const provider = new ethers.JsonRpcProvider(chain.rpcUrls[0]);
      const balance = await Promise.race([
        provider.getBalance(deployerAddress),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 6_000)),
      ]);
      return {
        chainId: parseInt(chainIdStr, 10),
        name: chain.name,
        shortName: chain.shortName,
        symbol: chain.symbol,
        balance: (balance as bigint).toString(),
        balanceFormatted: parseFloat(ethers.formatEther(balance as bigint)).toFixed(6),
        explorerUrl: chain.explorerUrl,
      };
    })
  );

  const liquidity = results.map((r, i) => {
    const [chainIdStr, chain] = Object.entries(DEST_CHAINS)[i];
    if (r.status === "fulfilled") return r.value;
    return {
      chainId: parseInt(chainIdStr, 10),
      name: chain.name,
      shortName: chain.shortName,
      symbol: chain.symbol,
      balance: null,
      balanceFormatted: null,
      error: (r.reason as Error)?.message ?? "RPC error",
      explorerUrl: chain.explorerUrl,
    };
  });

  res.json({ deployerAddress, liquidity });
});

// ── POST /api/gasrefuel/submit ────────────────────────────────────────────────

router.post("/gasrefuel/submit", async (req, res) => {
  const { arcTxHash, destChainId, recipient } = req.body ?? {};

  if (!arcTxHash || typeof arcTxHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(arcTxHash)) {
    res.status(400).json({ error: "Invalid arcTxHash" });
    return;
  }
  if (!destChainId || typeof destChainId !== "number" || !Number.isInteger(destChainId)) {
    res.status(400).json({ error: "Invalid destChainId — must be an integer" });
    return;
  }
  if (!recipient || !ethers.isAddress(recipient)) {
    res.status(400).json({ error: "Invalid recipient address" });
    return;
  }

  const chain = DEST_CHAINS[destChainId];
  if (!chain) {
    res.status(400).json({ error: `Unsupported destChainId: ${destChainId}` });
    return;
  }

  const privateKey = process.env["DEPLOYER_PRIVATE_KEY"];
  if (!privateKey) {
    res.status(503).json({ error: "Refuel service not configured" });
    return;
  }

  const normalizedHash = arcTxHash.toLowerCase();
  if (usedArcTxHashes.has(normalizedHash) || pendingArcTxHashes.has(normalizedHash)) {
    res.status(409).json({ error: "This Arc transaction has already been fulfilled" });
    return;
  }

  // Mark in-flight immediately — concurrent duplicates will 409 from here on
  pendingArcTxHashes.add(normalizedHash);

  try {
    // Step 1 — verify USDC Transfer on Arc ────────────────────────────────────
    const arcProvider = await getRpcProvider(ARC_RPC_URLS);
    const receipt = await Promise.race([
      arcProvider.getTransactionReceipt(arcTxHash),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("Arc RPC timeout")), 10_000)),
    ]);

    if (!receipt) {
      res.status(400).json({ error: "Arc transaction not found or not yet confirmed" });
      return;
    }

    if (receipt.status !== 1) {
      res.status(400).json({ error: "Arc transaction reverted — no USDC was transferred" });
      return;
    }

    const deployerWallet = new ethers.Wallet(privateKey);
    const deployerAddress = deployerWallet.address;
    const iface = new ethers.Interface(USDC_TRANSFER_ABI);
    let transferredAmount: bigint | null = null;
    let senderAddress: string | null = null;

    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== ARC_USDC.toLowerCase()) continue;
      try {
        const parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
        if (
          parsed?.name === "Transfer" &&
          (parsed.args[1] as string).toLowerCase() === deployerAddress.toLowerCase()
        ) {
          transferredAmount = parsed.args[2] as bigint;
          senderAddress = parsed.args[0] as string;
          break;
        }
      } catch {
        /* not a Transfer we care about */
      }
    }

    if (transferredAmount === null) {
      res.status(400).json({
        error: "No USDC transfer to the refuel deposit address found in this transaction",
      });
      return;
    }

    if (transferredAmount < MIN_USDC) {
      res.status(400).json({
        error: `Transfer too small — minimum is ${(Number(MIN_USDC) / 1e6).toFixed(2)} USDC`,
      });
      return;
    }

    if (transferredAmount > MAX_USDC) {
      res.status(400).json({
        error: `Transfer too large — maximum is ${(Number(MAX_USDC) / 1e6).toFixed(2)} USDC`,
      });
      return;
    }

    // Step 2 — price and calculate ────────────────────────────────────────────
    const nativeRate = await getNativePrice(chain.bandSymbol);
    const nativeWei = calcNativeWei(transferredAmount, nativeRate);

    // Guard: price feed glitch could floor nativeWei to 0 — never send 0
    if (nativeWei === 0n) {
      res.status(503).json({ error: "Calculated payout is zero — price feed issue, please try again" });
      return;
    }

    // Step 3 — check liquidity ────────────────────────────────────────────────
    const destProvider = await getRpcProvider(chain.rpcUrls);
    const liquidity = await destProvider.getBalance(deployerAddress);

    if (liquidity < nativeWei) {
      res.status(503).json({
        error: `Insufficient ${chain.symbol} liquidity on ${chain.name}. Available: ${ethers.formatEther(liquidity)} ${chain.symbol}`,
      });
      return;
    }

    // Step 4 — permanently record fulfillment before sending ──────────────────
    // pendingArcTxHashes already blocks concurrent duplicates from line 328.
    // usedArcTxHashes blocks all future replays (survives request lifecycle).
    usedArcTxHashes.add(normalizedHash);

    // Step 5 — send native gas ────────────────────────────────────────────────
    const destWallet = deployerWallet.connect(destProvider);
    const tx = await destWallet.sendTransaction({ to: recipient, value: nativeWei });

    req.log.info(
      {
        arcTxHash,
        destChainId,
        recipient,
        nativeWei: nativeWei.toString(),
        fulfillTx: tx.hash,
      },
      "gasrefuel fulfilled"
    );

    res.json({
      fulfillmentTxHash: tx.hash,
      destChainId,
      destChain: chain.name,
      nativeAmount: nativeWei.toString(),
      nativeAmountFormatted: parseFloat(ethers.formatEther(nativeWei)).toFixed(8),
      nativeSymbol: chain.symbol,
      recipient,
      sender: senderAddress,
      usdcUsed: transferredAmount.toString(),
      usdcUsedFormatted: (Number(transferredAmount) / 1e6).toFixed(6),
      explorerUrl: `${chain.explorerUrl}/tx/${tx.hash}`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);

    // Determine whether the transaction was likely broadcast before the error occurred.
    // Pre-broadcast failures (insufficient funds, nonce clash, invalid params) are safe
    // to retry — the tx never hit the network.  Post-broadcast failures (network
    // timeout reading the response, RPC disconnect mid-wait) leave the tx in-flight:
    // deleting from usedArcTxHashes here would allow a second send and double-pay the
    // user.  We keep them in usedArcTxHashes in that case so only server-restart
    // (acceptable for testnet) could allow a retry.
    const isDefinitelyPreBroadcast =
      msg.includes("insufficient funds") ||
      msg.includes("nonce too low") ||
      msg.includes("invalid argument") ||
      msg.includes("cannot estimate gas") ||
      msg.includes("Arc RPC timeout");   // our own timeout before any send attempt

    if (isDefinitelyPreBroadcast) {
      usedArcTxHashes.delete(normalizedHash);
    } else {
      req.log.warn(
        { arcTxHash, err },
        "gasrefuel send may have broadcast — keeping usedArcTxHashes entry to prevent double-pay"
      );
    }

    req.log.error({ err }, "gasrefuel submit error");

    // Sanitize — never leak raw RPC URLs or internal addresses in the API response.
    let userFacingError: string;
    if (msg.includes("insufficient funds")) {
      userFacingError = "Relayer has insufficient native token balance. Please try again later.";
    } else if (msg.includes("nonce too low")) {
      userFacingError = "Nonce conflict on the relayer — please retry in a moment.";
    } else if (msg.includes("cannot estimate gas") || msg.includes("estimateGas")) {
      userFacingError = "Gas estimation failed for the destination chain. The relayer may be misconfigured.";
    } else if (msg.includes("Arc RPC timeout")) {
      userFacingError = "Arc network timeout — the burn transaction could not be verified. No native gas was sent.";
    } else if (msg.includes("USDC transfer reverted")) {
      userFacingError = "USDC transfer reverted on-chain. Check your balance and allowance.";
    } else {
      // Strip any URL-like substrings before returning a truncated message.
      const sanitized = msg.replace(/https?:\/\/\S+/g, "[rpc]");
      userFacingError = `Fulfillment failed: ${sanitized.slice(0, 150)}`;
    }

    res.status(502).json({ error: userFacingError });
  } finally {
    // Always release the in-flight lock regardless of outcome
    pendingArcTxHashes.delete(normalizedHash);
  }
});

export default router;
