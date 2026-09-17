import {
  MAINNET_CHAINS,
  MAINNET_RELEASE,
} from "@workspace/arc-relay-sdk/mainnet";
import type { RequestHandler } from "express";

export type NetworkProfile = {
  environment: "mainnet";
  invalidEnvironment: boolean;
};

export type MainnetBlockedFeature =
  | "bridge"
  | "relay"
  | "gasless"
  | "refuel"
  | "yield"
  | "testnet-data";

const BLOCKED_PREFIXES: ReadonlyArray<readonly [string, MainnetBlockedFeature]> = [
  ["/relay", "relay"],
  ["/paymaster", "gasless"],
  ["/bundler", "gasless"],
  ["/gasrefuel", "refuel"],
  ["/yield", "yield"],
  // These endpoints expose only testnet deployments and/or testnet-indexed data.
  // Do not present that data as mainnet data while launch is pending.
  ["/contracts", "testnet-data"],
  ["/indexer", "testnet-data"],
  ["/oracle", "testnet-data"],
];

function normalizePath(path: string): string {
  const lowercase = path.toLowerCase();
  return lowercase.length > 1 ? lowercase.replace(/\/+$/, "") : lowercase;
}

/**
 * Resolve the environment at request/startup time. Invalid values deliberately
 * resolve to mainnet so a typo can never enable the testnet money-moving paths.
 */
export function getNetworkProfile(_ignoredLegacyValue?: unknown): NetworkProfile {
  return { environment: "mainnet", invalidEnvironment: false };
}

export function isMainnetProfile(): boolean {
  return true;
}

export function blockedFeatureForPath(path: string): MainnetBlockedFeature | null {
  const normalizedPath = normalizePath(path);
  for (const [prefix, feature] of BLOCKED_PREFIXES) {
    if (normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`)) return feature;
  }
  return null;
}

function isExplicitlySafeMainnetRequest(method: string, path: string): boolean {
  if (method !== "GET") return false;

  const normalizedPath = normalizePath(path);
  return (
    normalizedPath === "/healthz" ||
    normalizedPath === "/network-status" ||
    normalizedPath === "/chains" ||
    normalizedPath === "/attest"
  );
}

export function mainnetNotReadyBody(feature: MainnetBlockedFeature) {
  const capability =
    feature === "testnet-data"
      ? { reason: "Testnet deployment and indexed data are unavailable in the mainnet profile." }
      : MAINNET_RELEASE.features[feature];

  return {
    error: "Mainnet service is not ready",
    code: "MAINNET_NOT_READY",
    environment: "mainnet" as const,
    stage: MAINNET_RELEASE.stage,
    feature,
    reason: capability.reason,
  };
}

/**
 * This is mounted before body parsing. It makes the mainnet profile fail closed
 * even for malformed request bodies, and before any route can read a key,
 * construct a wallet, or contact a testnet service.
 */
export const mainnetSafetyGate: RequestHandler = (req, res, next) => {
  if (!isMainnetProfile()) {
    next();
    return;
  }

  if (isExplicitlySafeMainnetRequest(req.method, req.path)) {
    next();
    return;
  }

  // Default-deny unknown routes in mainnet. New side-effect endpoints cannot
  // become reachable merely because this allowlist was not updated.
  res.status(503).json(mainnetNotReadyBody(blockedFeatureForPath(req.path) ?? "bridge"));
};

export function mainnetChainsForResponse() {
  return Object.values(MAINNET_CHAINS).map((chain) => ({
    id: chain.id,
    name: chain.name,
    shortName: chain.shortName,
    cctpDomain: chain.cctpDomain,
    usdcAddress: chain.usdcAddress,
    tokenMessenger: chain.tokenMessenger,
    messageTransmitter: chain.messageTransmitter,
    explorerUrl: chain.explorerUrl,
    rpcUrl: chain.rpcUrl,
    nativeCurrency: chain.nativeCurrency,
    cctpVersion: chain.cctpVersion,
    minFinalityThreshold: chain.minFinalityThreshold,
    isArc: chain.isArc,
  }));
}
