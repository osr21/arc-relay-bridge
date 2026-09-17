/**
 * Public mainnet configuration. Mainnet addresses must never be populated from
 * the testnet deployment manifests, even when Circle uses the same domain IDs.
 * Official sources are recorded in docs/mainnet-preflight.md.
 */
export type MainnetFeature = "bridge" | "relay" | "gasless" | "refuel" | "yield";

export const MAINNET_IRIS_API = "https://iris-api.circle.com";
export const MAINNET_CCTP = {
  tokenMessenger: "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d",
  messageTransmitter: "0x81D40F21F12A8F0E3252Bccb954D722d4c464B64",
} as const;

export const MAINNET_CHAINS = {
  ARC_MAINNET: {
    id: 5042,
    hexId: "0x13b2",
    name: "Arc Mainnet",
    shortName: "Arc",
    rpcUrl: "https://rpc.mainnet.arc.io",
    rpcFallbacks: [] as string[],
    explorerUrl: "https://explorer.arc.io",
    cctpDomain: 26,
    usdcAddress: "0x3600000000000000000000000000000000000000",
    ...MAINNET_CCTP,
    nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
    isArc: true,
    cctpVersion: 2 as const,
    minFinalityThreshold: 2000,
    logoColor: "#354457",
  },
  BASE_MAINNET: {
    id: 8453,
    hexId: "0x2105",
    name: "Base Mainnet",
    shortName: "Base",
    rpcUrl: "https://mainnet.base.org",
    rpcFallbacks: [] as string[],
    explorerUrl: "https://basescan.org",
    cctpDomain: 6,
    usdcAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    ...MAINNET_CCTP,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    isArc: false,
    cctpVersion: 2 as const,
    minFinalityThreshold: 2000,
    logoColor: "#0052FF",
  },
} as const;

/**
 * Fail closed until a reviewed deployment manifest and operational checks exist.
 * There is intentionally no environment-variable switch that unlocks payments.
 * Yield is a separate product decision, not part of eventual bridge activation.
 */
export const MAINNET_RELEASE = {
  environment: "mainnet" as const,
  stage: "live" as const,
  live: true,
  features: {
    bridge: { enabled: true, reason: "Standard CCTP V2 Arc ↔ Base bridge is live." },
    relay: { enabled: false, reason: "The authenticated-payout relay contract must be reviewed, deployed and verified." },
    gasless: { enabled: false, reason: "Mainnet bundler support, paymaster review and sponsorship funding are pending." },
    refuel: { enabled: false, reason: "Mainnet payout verification, durable payment processing and liquidity are pending." },
    yield: { enabled: false, reason: "Yield is disabled until a real yield strategy is selected. Simulated vaults are testnet-only." },
  } satisfies Record<MainnetFeature, { enabled: boolean; reason: string }>,
};

export function isMainnetChainId(chainId: number): boolean {
  return Object.values(MAINNET_CHAINS).some((chain) => chain.id === chainId);
}

export function assertMainnetFeatureEnabled(feature: MainnetFeature): void {
  const capability = MAINNET_RELEASE.features[feature];
  if (!capability.enabled) throw new Error(capability.reason);
}
