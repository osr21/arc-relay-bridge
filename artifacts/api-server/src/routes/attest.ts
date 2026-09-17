import { Router, type IRouter } from "express";
import { MAINNET_IRIS_API } from "@workspace/arc-relay-sdk/mainnet";

const router: IRouter = Router();

const irisApi = () => MAINNET_IRIS_API;

type AttestationMessage = {
  attestation?: string;
  message?: string;
  status?: string;
  eventNonce?: string;
};

async function upstreamGet(url: string): Promise<{ ok: boolean; body: string; status: number }> {
  const upstream = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(8000),
  });
  let body = "";
  try { body = await upstream.text(); } catch { /* ignore */ }
  return { ok: upstream.ok, body, status: upstream.status };
}

function extractDetail(body: string, status: number): string {
  let detail = String(status);
  try {
    const parsed = JSON.parse(body);
    const msg = parsed?.error ?? parsed?.message ?? parsed?.detail;
    if (msg) detail += ` — ${String(msg).slice(0, 120)}`;
  } catch { /* body not JSON */ }
  return detail;
}

/**
 * GET /api/attest?domain=0&txHash=0xabc...
 *
 * Queries Circle's Iris API by transaction hash (v2 then v1 fallback).
 * Returns { messages: [...], diagnostic: "" } on success.
 */
router.get("/attest", async (req, res) => {
  const { domain, txHash } = req.query;

  if (!domain || !txHash || typeof domain !== "string" || typeof txHash !== "string") {
    res.status(400).json({ error: "Missing required query params: domain, txHash" });
    return;
  }

  if (!/^\d{1,10}$/.test(domain)) {
    res.status(400).json({ error: "Invalid domain — must be a positive integer" });
    return;
  }

  if (domain !== "26" && domain !== "6") {
    res.status(400).json({
      error: "Mainnet attestations only support Arc (26) and Base (6) source domains",
      code: "MAINNET_SOURCE_DOMAIN_NOT_ALLOWED",
    });
    return;
  }

  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    res.status(400).json({ error: "Invalid txHash — must be a 0x-prefixed 32-byte hex string" });
    return;
  }

  const iris = irisApi();
  const endpoints = [
    { label: "v2", url: `${iris}/v2/messages/${domain}?transactionHash=${txHash}` },
  ];

  const diagnostics: string[] = [];

  for (const { label, url } of endpoints) {
    try {
      const { ok, body, status } = await upstreamGet(url);

      if (!ok) {
        diagnostics.push(`${label}: ${extractDetail(body, status)}`);
        continue;
      }

      let data: { messages?: AttestationMessage[] } = {};
      try { data = JSON.parse(body); } catch {
        diagnostics.push(`${label}: invalid JSON`);
        continue;
      }

      const messages: AttestationMessage[] = data?.messages ?? [];
      res.json({ messages, diagnostic: "" });
      return;
    } catch (e) {
      const detail = e instanceof Error ? e.message.slice(0, 80) : String(e).slice(0, 80);
      diagnostics.push(`${label}: ${detail}`);
    }
  }

  res.json({ messages: [], diagnostic: diagnostics.join(" | ") });
});

export default router;
