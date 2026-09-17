/**
 * @workspace/arc-privacy-sdk — Arc Privacy Sector (APS) SDK
 *
 * Status: APS is on Arc's roadmap and is NOT YET DEPLOYED.
 * All methods throw ApsNotAvailableError until APS launches.
 *
 * Watch https://docs.arc.io/arc/concepts/arc-privacy-sector for updates.
 */

export { ApsClient } from "./client";
export type {
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
export {
  ApsNotAvailableError,
  ApsInsufficientBalanceError,
  ApsInvalidProofError,
} from "./types";
export {
  poseidonHash,
  computeNoteCommitment,
  computeNullifier,
  encryptNote,
  decryptNote,
  scanNotes,
  deriveApsKeys,
} from "./encrypt";
export type { EncryptedNote, NoteFields } from "./encrypt";

export const APS_NETWORK_STATUS = "NOT_DEPLOYED" as const;
export const APS_MEMO_CONTRACT  = "0x5294E9927c3306DcBaDb03fe70b92e01cCede505" as const;
export const ARC_TESTNET_CHAIN_ID = 5042002 as const;
