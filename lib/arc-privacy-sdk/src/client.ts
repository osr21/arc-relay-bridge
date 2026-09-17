/**
 * ApsClient — Arc Privacy Sector client (Tool G)
 *
 * All methods throw ApsNotAvailableError until APS launches on Arc Testnet.
 * The interface is fully typed so integrations can be written today and
 * activated by swapping in real implementations when the network goes live.
 *
 * When APS launches:
 *  1. Set ApsClientConfig.networkPublicKey to the published APS network key.
 *  2. Replace each `throw new ApsNotAvailableError(...)` with the real call.
 *  3. Install the APS proving WASM bundle or point provingServiceUrl at a
 *     trusted proving service.
 *
 * Usage:
 *   import { ApsClient } from "@workspace/arc-privacy-sdk";
 *   const aps = new ApsClient({ rpcUrl: "https://rpc.testnet.arc.network" });
 *   const identity = await aps.generateIdentity(privateKey);
 *   await aps.deposit({ amount: 1_000_000n }); // throws ApsNotAvailableError until live
 */

import type {
  ApsClientConfig,
  ApsIdentity,
  ApsDepositParams,
  ApsTransferParams,
  ApsWithdrawParams,
  ApsCctpBridgeParams,
  ApsNote,
  ApsZkProof,
  ApsViewRecord,
  ApsNetworkStatus,
} from "./types";
import { ApsNotAvailableError } from "./types";

const APS_NETWORK_STATUS: ApsNetworkStatus = "NOT_DEPLOYED";

export class ApsClient {
  readonly config: ApsClientConfig;
  readonly networkStatus: ApsNetworkStatus = APS_NETWORK_STATUS;

  constructor(config: ApsClientConfig = {}) {
    this.config = {
      rpcUrl: "https://rpc.testnet.arc.network",
      ...config,
    };
  }

  // ── Identity ───────────────────────────────────────────────────────────────

  /**
   * Derives an APS identity from an EOA private key using a deterministic
   * key derivation path. The APS address is unlinkable to the EOA address
   * without the derivation key.
   *
   * @param privateKey — EOA private key (hex, 0x-prefixed)
   * @returns ApsIdentity with APS address, public key, and viewing key
   */
  async generateIdentity(_privateKey: `0x${string}`): Promise<ApsIdentity> {
    throw new ApsNotAvailableError("generateIdentity");
  }

  /**
   * Restores an APS identity from a previously generated private key.
   * Scans the APS merkle tree to recover unspent notes.
   */
  async restoreIdentity(_privateKey: `0x${string}`): Promise<ApsIdentity> {
    throw new ApsNotAvailableError("restoreIdentity");
  }

  // ── Balance ────────────────────────────────────────────────────────────────

  /**
   * Returns the total shielded USDC balance for an APS identity.
   * Computed by summing all unspent notes decryptable by the identity's key.
   *
   * @returns Balance in 6-decimal USDC units
   */
  async getBalance(_identity: ApsIdentity): Promise<bigint> {
    throw new ApsNotAvailableError("getBalance");
  }

  /**
   * Returns all unspent notes (UTXOs) belonging to an identity.
   * Notes are encrypted on-chain and decryptable only with the identity key.
   */
  async getNotes(_identity: ApsIdentity): Promise<ApsNote[]> {
    throw new ApsNotAvailableError("getNotes");
  }

  // ── Transactions ───────────────────────────────────────────────────────────

  /**
   * Deposits USDC from a transparent EOA into APS.
   * Moves USDC to the APS pool contract and creates an encrypted note.
   *
   * Steps (when APS is live):
   *  1. Approve the APS pool contract to spend USDC.
   *  2. Generate a deposit note commitment.
   *  3. Submit the deposit transaction with the commitment.
   *
   * @returns Transaction hash of the deposit
   */
  async deposit(_params: ApsDepositParams): Promise<`0x${string}`> {
    throw new ApsNotAvailableError("deposit");
  }

  /**
   * Transfers USDC between two APS identities (fully shielded).
   * No on-chain link between sender and recipient is revealed.
   *
   * Steps (when APS is live):
   *  1. Select notes covering the transfer amount (note selection algorithm).
   *  2. Generate a zk-proof of note ownership and value conservation.
   *  3. Submit the proof + encrypted output notes on-chain.
   *
   * @returns Transaction hash of the shielded transfer
   */
  async transfer(_params: ApsTransferParams): Promise<`0x${string}`> {
    throw new ApsNotAvailableError("transfer");
  }

  /**
   * Withdraws USDC from APS to a transparent address.
   * Reveals only the destination address and amount; sender's APS history
   * remains private.
   *
   * @returns Transaction hash of the withdrawal
   */
  async withdraw(_params: ApsWithdrawParams): Promise<`0x${string}`> {
    throw new ApsNotAvailableError("withdraw");
  }

  /**
   * Bridges shielded USDC out of APS on Arc to another chain via CCTP v2.
   * Combines an APS withdrawal with a CCTP depositForBurn in a single tx
   * to avoid linking the withdrawal address to the bridge depositor.
   *
   * @returns Transaction hash of the shielded bridge-out
   */
  async bridgeOut(_params: ApsCctpBridgeParams): Promise<`0x${string}`> {
    throw new ApsNotAvailableError("bridgeOut");
  }

  // ── Proving ────────────────────────────────────────────────────────────────

  /**
   * Generates a Groth16 zk-proof for a shielded transaction.
   * Can run locally (WASM prover) or via a remote proving service.
   *
   * @param circuit — circuit identifier ("deposit" | "transfer" | "withdraw")
   * @param inputs  — private inputs for the circuit
   * @returns ApsZkProof ready for on-chain verification
   */
  async prove(_circuit: string, _inputs: Record<string, bigint | bigint[]>): Promise<ApsZkProof> {
    throw new ApsNotAvailableError("prove");
  }

  /**
   * Verifies a zk-proof against the APS verifier contract on-chain.
   * Useful for compliance tools that need to verify disclosed proofs.
   */
  async verify(_proof: ApsZkProof): Promise<boolean> {
    throw new ApsNotAvailableError("verify");
  }

  // ── Viewing / Compliance ───────────────────────────────────────────────────

  /**
   * Decrypts and returns the full transaction history visible with a viewing key.
   * Useful for providing read-only audit access to regulators or compliance teams.
   *
   * @param viewingKey — viewing key from ApsIdentity.viewingKey
   * @returns Array of decrypted transaction records
   */
  async getHistory(_viewingKey: `0x${string}`): Promise<ApsViewRecord[]> {
    throw new ApsNotAvailableError("getHistory");
  }

  /**
   * Generates a selective disclosure proof that reveals a specific transaction
   * to a verifier without exposing the full history.
   *
   * @param identity  — APS identity (need full key, not just viewing key)
   * @param txHash    — transaction to disclose
   * @returns Proof bytes that the verifier can check on-chain
   */
  async generateDisclosureProof(
    _identity: ApsIdentity,
    _txHash: `0x${string}`
  ): Promise<Uint8Array> {
    throw new ApsNotAvailableError("generateDisclosureProof");
  }

  // ── Merkle Tree ────────────────────────────────────────────────────────────

  /**
   * Returns the current Merkle root of the APS note commitment tree.
   * Required as a public input for zk-proofs.
   */
  async getMerkleRoot(): Promise<`0x${string}`> {
    throw new ApsNotAvailableError("getMerkleRoot");
  }

  /**
   * Returns the Merkle proof path for a given note commitment.
   * Required for the spend circuit to prove note inclusion.
   */
  async getMerklePath(_commitment: `0x${string}`): Promise<`0x${string}`[]> {
    throw new ApsNotAvailableError("getMerklePath");
  }
}
