export interface ChainConfig {
  id: number;
  hexId: string;
  name: string;
  shortName: string;
  rpcUrl: string;
  rpcFallbacks: string[];
  explorerUrl: string;
  cctpDomain: number;
  usdcAddress: string;
  tokenMessenger: string;
  messageTransmitter: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  isArc?: boolean;
  /** CCTP version used by this chain's TokenMessenger (1 = V1 4-param, 2 = V2 7-param) */
  cctpVersion?: 1 | 2;
  /**
   * CCTP V2 minFinalityThreshold passed to depositForBurn.
   * 2000 = fully finalized, 1000 = safe (~1-2 min), 0 = fast.
   * Defaults to 1000 if unset.
   */
  minFinalityThreshold?: number;
  /**
   * Hard-coded gas limit override for chains whose eth_estimateGas endpoint
   * is unreliable (e.g. Arc Testnet returns data=null for complex calls).
   * When set, ethers.js skips estimateGas and uses this value directly.
   */
  gasLimitOverride?: bigint;
  /**
   * GasRelayer contract address on this chain.
   * When set, users can enable Gas Relay mode: burn with mintRecipient = GasRelayer,
   * then the relay API mints USDC on their behalf (no destination-chain gas needed).
   */
  gasRelayerAddress?: string;
  logoColor: string;
}

export const CHAINS: Record<string, ChainConfig> = {
  ARC_TESTNET: {
    id: 5042002,
    hexId: "0x4CEF52",
    name: "Arc Testnet",
    shortName: "Arc",
    rpcUrl: "https://rpc.drpc.testnet.arc.network",
    rpcFallbacks: [
      "https://rpc.testnet.arc.network",
    ],
    explorerUrl: "https://testnet.arcscan.app",
    cctpDomain: 26,
    usdcAddress: "0x3600000000000000000000000000000000000000",
    tokenMessenger: "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA",
    messageTransmitter: "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275",
    nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
    isArc: true,
    cctpVersion: 2,
    minFinalityThreshold: 2000,
    gasLimitOverride: 600000n,
    gasRelayerAddress: "0x837D9a19C07bb7B4E95071dC0BaED72D4dE04ea1",
    logoColor: "#354457",
  },
  ETH_SEPOLIA: {
    id: 11155111,
    hexId: "0xaa36a7",
    name: "Ethereum Sepolia",
    shortName: "Sepolia",
    rpcUrl: "https://ethereum-sepolia-rpc.publicnode.com",
    rpcFallbacks: [
      "https://sepolia.drpc.org",
      "https://1rpc.io/sepolia",
    ],
    explorerUrl: "https://sepolia.etherscan.io",
    cctpDomain: 0,
    usdcAddress: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    tokenMessenger: "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA",
    messageTransmitter: "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    cctpVersion: 2,
    minFinalityThreshold: 0,
    gasRelayerAddress: "0x5E87F210043D8457caCAd0F0c9aB70a99497Eec9",
    logoColor: "#627EEA",
  },
  BASE_SEPOLIA: {
    id: 84532,
    hexId: "0x14A34",
    name: "Base Sepolia",
    shortName: "Base Sep",
    rpcUrl: "https://sepolia.base.org",
    rpcFallbacks: [
      "https://base-sepolia.drpc.org",
      "https://base-sepolia-rpc.publicnode.com",
    ],
    explorerUrl: "https://sepolia.basescan.org",
    cctpDomain: 6,
    usdcAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    tokenMessenger: "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA",
    messageTransmitter: "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    cctpVersion: 2,
    minFinalityThreshold: 0,
    gasRelayerAddress: "0x64D160b7E91e78e52dFc0e8829640E32A919164C",
    logoColor: "#0052FF",
  },
  AVAX_FUJI: {
    id: 43113,
    hexId: "0xA869",
    name: "Avalanche Fuji",
    shortName: "Fuji",
    rpcUrl: "https://api.avax-test.network/ext/bc/C/rpc",
    rpcFallbacks: [
      "https://avalanche-fuji.drpc.org",
    ],
    explorerUrl: "https://testnet.snowtrace.io",
    cctpDomain: 1,
    usdcAddress: "0x5425890298aed601595a70AB815c96711a31Bc65",
    tokenMessenger: "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA",
    messageTransmitter: "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275",
    nativeCurrency: { name: "AVAX", symbol: "AVAX", decimals: 18 },
    cctpVersion: 2,
    minFinalityThreshold: 0,
    gasRelayerAddress: "0x6F80056564491425273A6a481EcC5DAea9D57f23",
    logoColor: "#E84142",
  },
};

export const CHAIN_LIST = Object.values(CHAINS);

export function getChainById(id: number): ChainConfig | undefined {
  return CHAIN_LIST.find((c) => c.id === id);
}

/**
 * Create a JsonRpcProvider for a chain, trying the primary RPC first
 * and falling back to the rpcFallbacks list if the primary fails.
 */
export async function createRpcProvider(
  chain: ChainConfig
): Promise<import("ethers").JsonRpcProvider> {
  const { ethers } = await import("ethers");
  const urls = [chain.rpcUrl, ...chain.rpcFallbacks];

  let lastErr: unknown;
  for (const url of urls) {
    try {
      const provider = new ethers.JsonRpcProvider(url);
      // Quick liveness check
      await provider.getBlockNumber();
      return provider;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr ?? new Error(`All RPCs failed for ${chain.name}`);
}

export const ATTESTATION_API = "https://iris-api-sandbox.circle.com";

export const USDC_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function transfer(address to, uint256 amount) returns (bool)",
];

/** CCTP V1 TokenMessenger ABI (kept for reference — not used, all chains use V2) */
export const TOKEN_MESSENGER_ABI = [
  "function depositForBurn(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken) returns (uint64 nonce)",
  "event MessageSent(bytes message)",
];

/**
 * CCTP V2 TokenMessenger ABI (all chains).
 * Selector 0x8e0250ee — adds destinationCaller, maxFee, minFinalityThreshold.
 * destinationCaller = bytes32(0) → anyone may relay
 * maxFee = 0 → no premium for fast finality
 */
export const TOKEN_MESSENGER_V2_ABI = [
  "function depositForBurn(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold) returns (uint64 nonce)",
  "event MessageSent(bytes message)",
];

export const MESSAGE_TRANSMITTER_ABI = [
  "function receiveMessage(bytes message, bytes attestation) returns (bool success)",
  "function usedNonces(bytes32 sourceAndNonce) view returns (uint256)",
];
