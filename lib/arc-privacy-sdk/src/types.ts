/**
 * Arc Privacy Sector (APS) SDK — Type Definitions (Tool G)
 *
 * APS is on Arc's roadmap and is not yet deployed on Arc Testnet or Mainnet.
 * These types document the anticipated interface so integrations can be
 * written ahead of launch. All client methods throw `ApsNotAvailableError`
 * until the APS network public key is published and the endpoints go live.
 *
 * Source: https://docs.arc.io/arc/concepts/arc-privacy-sector
 */

// ── Status ────────────────────────────────────────────────────────────────────

export type ApsNetworkStatus = "NOT_DEPLOYED" | "TESTNET" | "MAINNET";

// ── Identity ──────────────────────────────────────────────────────────────────

/**
 * An APS identity represents a pseudonymous on-chain identity whose
 * transactions are unlinkable without the holder's disclosure key.
 */
export interface ApsIdentity {
  /** Derived APS address (distinct from the EOA address). */
  address: `0x${string}`;
  /** Public key for this identity (compressed secp256k1, 33 bytes hex). */
  publicKey: `0x${string}`;
  /**
   * Viewing key allows read-only disclosure of transaction history to a
   * third party (auditor, compliance officer) without spend authority.
   */
  viewingKey: `0x${string}`;
}

// ── Transaction Types ─────────────────────────────────────────────────────────

/** A shielded deposit moves USDC from a transparent EOA into APS. */
export interface ApsDepositParams {
  /** Amount in 6-decimal USDC (e.g., 1_000_000 = $1.00). */
  amount: bigint;
  /** Recipient APS identity address. Defaults to sender's own APS address. */
  recipient?: `0x${string}`;
  /** Optional application-level memo (encrypted, only readable with viewing key). */
  memo?: Uint8Array;
}

/** A shielded transfer moves USDC between two APS identities. */
export interface ApsTransferParams {
  /** Sender's APS identity. */
  from: ApsIdentity;
  /** Recipient's APS public key (not their EOA address). */
  toPublicKey: `0x${string}`;
  /** Amount in 6-decimal USDC. */
  amount: bigint;
  /** Optional memo (encrypted to recipient's viewing key). */
  memo?: Uint8Array;
}

/** A shielded withdrawal moves USDC from APS back to a transparent address. */
export interface ApsWithdrawParams {
  /** APS identity performing the withdrawal. */
  from: ApsIdentity;
  /** Destination transparent address. */
  toAddress: `0x${string}`;
  /** Amount in 6-decimal USDC. */
  amount: bigint;
}

/** A shielded CCTP bridge burns USDC in APS on Arc and mints it on the destination chain. */
export interface ApsCctpBridgeParams {
  /** APS identity performing the bridge. */
  from: ApsIdentity;
  /** Destination chain CCTP domain. */
  destinationDomain: number;
  /** Mint recipient on destination chain (bytes32). */
  mintRecipient: `0x${string}`;
  /** Amount in 6-decimal USDC. */
  amount: bigint;
  /** Max fee (0 for testnet). */
  maxFee?: bigint;
  /** Min finality threshold per destination chain. */
  minFinalityThreshold?: number;
}

// ── Proof & Note Types ────────────────────────────────────────────────────────

/**
 * A shielded note represents a UTXO-style balance commitment inside APS.
 * Notes are created on deposit/receive and consumed on transfer/withdraw.
 */
export interface ApsNote {
  /** Note commitment (Poseidon hash of value + nullifier + recipient pubkey). */
  commitment: `0x${string}`;
  /** Value in 6-decimal USDC. */
  value: bigint;
  /** Block number when the note was created. */
  blockNumber: bigint;
  /** Whether this note has been spent. */
  spent: boolean;
  /** Nullifier (revealed on spend, prevents double-spend). */
  nullifier?: `0x${string}`;
}

/**
 * A zk-proof that a shielded transaction is valid without revealing inputs.
 * APS uses Groth16 proofs over BN254.
 */
export interface ApsZkProof {
  /** Proof bytes (Groth16, 256 bytes). */
  proof: Uint8Array;
  /** Public signals (commitment, nullifier, root). */
  publicSignals: bigint[];
}

// ── Viewing ───────────────────────────────────────────────────────────────────

/** Decrypted transaction history visible with a viewing key. */
export interface ApsViewRecord {
  txHash: `0x${string}`;
  blockNumber: bigint;
  type: "DEPOSIT" | "TRANSFER_IN" | "TRANSFER_OUT" | "WITHDRAW" | "BRIDGE_OUT";
  amount: bigint;
  counterpartyAddress?: `0x${string}`;
  memo?: Uint8Array;
  memoText?: string;
  timestamp: number;
}

// ── Config ────────────────────────────────────────────────────────────────────

export interface ApsClientConfig {
  /** RPC URL for Arc Testnet or Mainnet. */
  rpcUrl?: string;
  /**
   * APS network public key (provided when APS launches).
   * Used for note encryption. Must be updated when APS goes live.
   */
  networkPublicKey?: `0x${string}`;
  /**
   * APS proving service URL (optional — proof generation can be done locally
   * using the WASM prover bundle, or delegated to a proving service).
   */
  provingServiceUrl?: string;
}

// ── Errors ────────────────────────────────────────────────────────────────────

export class ApsNotAvailableError extends Error {
  readonly code = "APS_NOT_AVAILABLE";
  constructor(method: string) {
    super(
      `APS.${method}() is not yet available — Arc Privacy Sector has not launched on testnet. ` +
      "Follow https://docs.arc.io for launch announcements. " +
      "Update ApsClientConfig.networkPublicKey when the network key is published."
    );
    this.name = "ApsNotAvailableError";
  }
}

export class ApsInsufficientBalanceError extends Error {
  readonly code = "APS_INSUFFICIENT_BALANCE";
  constructor(required: bigint, available: bigint) {
    super(
      `APS balance insufficient: required ${required} USDC-units, available ${available} USDC-units`
    );
    this.name = "ApsInsufficientBalanceError";
  }
}

export class ApsInvalidProofError extends Error {
  readonly code = "APS_INVALID_PROOF";
  constructor(detail?: string) {
    super(`APS zk-proof verification failed${detail ? ": " + detail : ""}`);
    this.name = "ApsInvalidProofError";
  }
}
