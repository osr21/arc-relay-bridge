import { Router, type IRouter } from "express";
import { ethers } from "ethers";

const router: IRouter = Router();

const BAND_ORACLE_ADDRESS = "0x8c064bCf7C0DA3B3b090BAbFE8f3323534D84d68";
const ARC_RPC = "https://rpc.drpc.testnet.arc.network";
const ARC_RPC_FALLBACK = "https://rpc.testnet.arc.network";

const BAND_ABI = [
  "function getReferenceData(string base, string quote) view returns (uint256 rate, uint256 lastUpdatedBase, uint256 lastUpdatedQuote)",
];

let cachedPrice: { rate: string; lastUpdated: number; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 30_000; // 30 seconds

async function fetchBandPrice(): Promise<{ rate: string; lastUpdated: number }> {
  const urls = [ARC_RPC, ARC_RPC_FALLBACK];
  let lastErr: unknown;

  for (const url of urls) {
    try {
      const provider = new ethers.JsonRpcProvider(url);
      const contract = new ethers.Contract(BAND_ORACLE_ADDRESS, BAND_ABI, provider);
      const [rate, , lastUpdatedBase] = await Promise.race([
        contract.getReferenceData("USDC", "USD") as Promise<[bigint, bigint, bigint]>,
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 6000)),
      ]);
      return {
        rate: rate.toString(),
        lastUpdated: Number(lastUpdatedBase),
      };
    } catch (err) {
      lastErr = err;
    }
  }

  throw lastErr ?? new Error("Band oracle unreachable");
}

/**
 * GET /api/oracle/price
 *
 * Returns the live USDC/USD price from Band Protocol's reference contract on Arc Testnet.
 * Rate is 1e18-scaled (e.g. 1000000000000000000 = $1.00).
 * Cached for 30 seconds to avoid hammering the RPC.
 *
 * Response: { rate, rateFormatted, lastUpdated, source, cachedAt }
 */
router.get("/oracle/price", async (_req, res) => {
  const now = Date.now();

  if (cachedPrice && now - cachedPrice.fetchedAt < CACHE_TTL_MS) {
    res.json({
      rate: cachedPrice.rate,
      rateFormatted: (Number(cachedPrice.rate) / 1e18).toFixed(6),
      lastUpdated: cachedPrice.lastUpdated,
      source: "band_protocol",
      oracle: BAND_ORACLE_ADDRESS,
      cachedAt: cachedPrice.fetchedAt,
      cached: true,
    });
    return;
  }

  try {
    const { rate, lastUpdated } = await fetchBandPrice();
    cachedPrice = { rate, lastUpdated, fetchedAt: now };
    res.json({
      rate,
      rateFormatted: (Number(rate) / 1e18).toFixed(6),
      lastUpdated,
      source: "band_protocol",
      oracle: BAND_ORACLE_ADDRESS,
      cachedAt: now,
      cached: false,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message.slice(0, 120) : String(err).slice(0, 120);
    res.status(503).json({ error: `Band oracle unavailable: ${msg}` });
  }
});

export default router;
