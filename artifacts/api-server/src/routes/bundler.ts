import { Router } from "express";

const router = Router();

const VALID_NETWORKS = new Set(["sepolia", "base-sepolia", "avalanche-fuji"]);

router.post("/bundler/:network", async (req, res) => {
  const { network } = req.params;

  if (!VALID_NETWORKS.has(network)) {
    res.status(400).json({ error: "Unsupported network" });
    return;
  }

  const apiKey = process.env["PIMLICO_API_KEY"];
  if (!apiKey) {
    res.status(500).json({ error: "Bundler not configured" });
    return;
  }

  try {
    const url = `https://api.pimlico.io/v2/${network}/rpc?apikey=${apiKey}`;
    const upstream = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body),
    });
    const data = await upstream.json();
    res.status(upstream.status).json(data);
  } catch (err) {
    req.log.error({ err }, "Bundler proxy error");
    res.status(502).json({ error: "Bundler unreachable" });
  }
});

export default router;
