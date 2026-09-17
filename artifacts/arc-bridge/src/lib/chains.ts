import { MAINNET_CHAINS, MAINNET_IRIS_API } from "@workspace/arc-relay-sdk/mainnet";

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

const MAINNET_CHAIN_CONFIG: Record<string, ChainConfig> = {
  ARC_MAINNET: { ...MAINNET_CHAINS.ARC_MAINNET },
  BASE_MAINNET: { ...MAINNET_CHAINS.BASE_MAINNET },
};

/** Only Arc (5042) and Base (8453) are selectable in the default mainnet-preparing build. */
export const CHAINS: Record<string, ChainConfig> = MAINNET_CHAIN_CONFIG;

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

/** No sandbox Iris fallback is permitted in a mainnet build. */
export const ATTESTATION_API = MAINNET_IRIS_API;

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
