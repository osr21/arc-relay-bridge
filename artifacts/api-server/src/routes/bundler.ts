import { Router } from "express";

const router = Router();

const VALID_NETWORKS = new Set(["sepolia", "base-sepolia", "avalanche-fuji"]);

// Whitelist of JSON-RPC methods the bundler proxy is allowed to forward.
// Prevents this endpoint from being used as an open proxy for arbitrary Pimlico calls.
const ALLOWED_METHODS = new Set([
  // ERC-4337 standard methods
  "eth_sendUserOperation",
  "eth_estimateUserOperationGas",
  "eth_getUserOperationByHash",
  "eth_getUserOperationReceipt",
  "eth_supportedEntryPoints",
  // Pimlico-specific methods
  "pimlico_getUserOperationGasPrice",
  "pimlico_sendCompressedUserOperation",
  "pimlico_getUserOperationStatus",
  // Pimlico paymaster methods (used by permissionless for sponsored UserOps)
  "pm_getPaymasterStubData",
  "pm_getPaymasterData",
]);

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

  const { method } = req.body ?? {};
  if (typeof method !== "string" || !ALLOWED_METHODS.has(method)) {
    res.status(400).json({ error: `Method not allowed: ${method}` });
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
