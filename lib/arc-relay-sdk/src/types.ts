/**
 * Arc Relay SDK — shared TypeScript types.
 */

/** A chain supported by the Arc Relay Bridge. */
export interface Chain {
  /** EVM chain ID. */
  id: number;
  /** Human-readable chain name. */
  name: string;
  /** Abbreviated name (e.g. "Sepolia"). */
  shortName: string;
  /** Circle CCTP V2 domain number. */
  cctpDomain: number;
  /** Primary public JSON-RPC endpoint. */
  rpcUrl: string;
  /** USDC contract address on this chain (6 decimals via ERC-20 interface). */
  usdcAddress: string;
  /** CCTP V2 TokenMessenger address (same on all chains). */
  tokenMessenger: string;
  /** CCTP V2 MessageTransmitter address (same on all chains). */
  messageTransmitter: string;
  /** GasRelayer paymaster contract address (if gasless relay is supported). */
  gasRelayerAddress?: string;
  /** Block explorer base URL (no trailing slash). */
  explorerUrl: string;
  /**
   * minFinalityThreshold passed to CCTP V2 depositForBurn.
   * 2000 = finalized (Arc Testnet), 1000 = safe (~1-2 min attestation on other chains).
   */
  minFinalityThreshold: number;
}

/** Result of fee calculation for a bridge transfer. */
export interface FeeBreakdown {
  /** Raw input amount in USDC units (6 decimals). */
  grossAmount: bigint;
  /** Protocol fee deducted on the source chain (ERC-20 transfer before burn). */
  protocolFee: bigint;
  /** Amount that enters the CCTP burn (grossAmount - protocolFee). */
  bridgeAmount: bigint;
  /** Relay fee deducted on the destination chain by GasRelayer. 0n if not using gasless relay. */
  relayFee: bigint;
  /** Final amount the recipient wallet receives (bridgeAmount - relayFee). */
  netAmount: bigint;
  /** Protocol fee in basis points used for this calculation. */
  feeBps: number;
}

/** Successful attestation returned by Circle Iris. */
export interface AttestationResult {
  /** Raw CCTP message bytes (0x-prefixed hex). */
  message: string;
  /** Circle Iris attestation signature (0x-prefixed hex). */
  attestation: string;
}

/** Response from the Arc Relay API relay endpoint. */
export interface RelayResult {
  /** Transaction hash of the GasRelayer.relay() call on the destination chain. */
  txHash: string;
  /** Relay fee actually charged, in USDC units (6 decimals). */
  relayFee: string;
  /** Human-readable name of the destination chain. */
  chain: string;
}

/** Response from the Arc Relay API chains endpoint. */
export interface ChainInfo {
  id: number;
  name: string;
  shortName: string;
  cctpDomain: number;
  usdcAddress: string;
  gasRelayerAddress: string | null;
  explorerUrl: string;
  relayFeeUnits: string;
}
