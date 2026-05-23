import { Router, type IRouter } from "express";

const router: IRouter = Router();

const IRIS_API = "https://iris-api-sandbox.circle.com";

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

  const endpoints = [
    { label: "v2", url: `${IRIS_API}/v2/messages/${domain}?transactionHash=${txHash}` },
    { label: "v1", url: `${IRIS_API}/v1/messages/${domain}/${txHash}` },
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

/**
 * GET /api/attest/hash/:messageHash
 *
 * Queries Circle's Iris API by message hash — keccak256(messageBytes).
 * This is the content-based endpoint that works regardless of source chain.
 * Returns { attestation, status, diagnostic }.
 */
router.get("/attest/hash/:messageHash", async (req, res) => {
  const { messageHash } = req.params;

  if (!messageHash || !/^0x[0-9a-fA-F]{64}$/.test(messageHash)) {
    res.status(400).json({ error: "Invalid messageHash — must be 0x-prefixed 32-byte hex" });
    return;
  }

  const url = `${IRIS_API}/v1/attestations/${messageHash}`;

  try {
    const { ok, body, status } = await upstreamGet(url);

    if (!ok) {
      res.json({ attestation: null, status: null, diagnostic: extractDetail(body, status) });
      return;
    }

    let data: { attestation?: string; status?: string } = {};
    try { data = JSON.parse(body); } catch {
      res.json({ attestation: null, status: null, diagnostic: "invalid JSON from upstream" });
      return;
    }

    res.json({
      attestation: data.attestation ?? null,
      status: data.status ?? null,
      diagnostic: "",
    });
  } catch (e) {
    const detail = e instanceof Error ? e.message.slice(0, 80) : String(e).slice(0, 80);
    res.json({ attestation: null, status: null, diagnostic: detail });
  }
});

export default router;
