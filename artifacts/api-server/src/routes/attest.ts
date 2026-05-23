import { Router, type IRouter } from "express";

const router: IRouter = Router();

const IRIS_API = "https://iris-api-sandbox.circle.com";

type AttestationMessage = {
  attestation?: string;
  message?: string;
  status?: string;
  eventNonce?: string;
};

/**
 * GET /api/attest?domain=0&txHash=0xabc...
 *
 * Server-side proxy for Circle's Iris attestation API.
 * Avoids browser CORS restrictions by forwarding the request from Node.
 * Tries v2 endpoint first, falls back to v1.
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
      const upstream = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(8000),
      });

      let body = "";
      try { body = await upstream.text(); } catch { /* ignore */ }

      if (!upstream.ok) {
        let detail = String(upstream.status);
        try {
          const parsed = JSON.parse(body);
          const msg = parsed?.error ?? parsed?.message ?? parsed?.detail;
          if (msg) detail += ` — ${String(msg).slice(0, 120)}`;
        } catch { /* body not JSON */ }
        diagnostics.push(`${label}: ${detail}`);
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
