import {
  MAINNET_RELEASE,
  type MainnetFeature,
} from "@workspace/arc-relay-sdk/mainnet";

/**
 * The default is deliberately mainnet preparation. Testnet is available only
 * through an explicit build-time environment, never through a UI control.
 */
/** Mainnet is hard-coded; there is deliberately no testnet escape hatch. */
export const NETWORK_ENV = "mainnet" as const;
export const IS_MAINNET = true;

export const MAINNET_NOT_LIVE_REASON =
  "Only the standard Arc Mainnet ↔ Base Mainnet CCTP V2 bridge is available.";

export function assertFeatureAvailable(feature: MainnetFeature): void {
  const capability = MAINNET_RELEASE.features[feature];
  if (!capability.enabled) throw new Error(capability.reason);
}

export interface NetworkStatus {
  environment: "mainnet";
  configurationValid: boolean;
  mainnet: typeof MAINNET_RELEASE;
  activeChains: Array<{ id: number }>;
}

/** Check that the API is serving the mainnet-only configuration. */
export async function assertBackendEnvironment(): Promise<void> {
  const response = await fetch("/api/network-status", { signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error("Network status is unavailable; mainnet actions remain disabled.");
  const status = await response.json() as NetworkStatus;
  if (status.environment !== NETWORK_ENV) {
    throw new Error(`Network mismatch: this app is ${NETWORK_ENV}, but the API reports ${status.environment}.`);
  }
  if (!status.configurationValid) {
    throw new Error("The API network configuration is invalid; mainnet actions remain disabled.");
  }
  const chainIds = status.activeChains?.map((chain) => chain.id).sort((a, b) => a - b);
  if (!chainIds || chainIds.length !== 2 || chainIds[0] !== 5042 || chainIds[1] !== 8453) {
    throw new Error("The API is not configured for Arc Mainnet and Base Mainnet.");
  }
}