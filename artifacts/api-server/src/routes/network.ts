import { Router, type IRouter } from "express";
import { MAINNET_RELEASE } from "@workspace/arc-relay-sdk/mainnet";
import {
  getNetworkProfile,
  mainnetChainsForResponse,
} from "../lib/network";

const router: IRouter = Router();

/**
 * GET /api/network-status
 *
 * Public, non-sensitive readiness information. It never inspects deployment
 * keys, RPC credentials, or any other secret configuration.
 */
router.get("/network-status", (_req, res) => {
  const profile = getNetworkProfile();

  res.json({
    environment: profile.environment,
    configurationValid: !profile.invalidEnvironment,
    mainnet: {
      stage: MAINNET_RELEASE.stage,
      live: MAINNET_RELEASE.live,
      features: MAINNET_RELEASE.features,
    },
    activeChains: mainnetChainsForResponse(),
  });
});

export default router;