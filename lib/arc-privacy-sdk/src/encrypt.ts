/**
 * APS Encryption Utilities (Tool G)
 *
 * Implements note encryption/decryption for Arc Privacy Sector.
 * Uses hybrid encryption: ephemeral ECDH key agreement + AES-256-GCM.
 *
 * When APS launches:
 *  1. Replace the stub implementations with real logic.
 *  2. Use the APS network public key from ApsClientConfig.networkPublicKey
 *     for pool-level encryption (deposit commitments).
 *  3. Use recipient's public key for note-level encryption (transfers).
 *
 * Algorithm:
 *  - Key agreement: ECDH on secp256k1
 *  - Shared secret: SHA-256(ECDH shared point x-coordinate)
 *  - Encryption: AES-256-GCM with random 96-bit nonce
 *  - Ciphertext format: [nonce (12 bytes) || tag (16 bytes) || ciphertext]
 */

import { ApsNotAvailableError } from "./types";

// ── Interfaces ────────────────────────────────────────────────────────────────

export interface EncryptedNote {
  /** Ephemeral sender public key (33 bytes, compressed secp256k1). */
  ephemeralPublicKey: Uint8Array;
  /** AES-256-GCM nonce (12 bytes). */
  nonce: Uint8Array;
  /** Ciphertext + GCM auth tag (variable length). */
  ciphertext: Uint8Array;
}

export interface NoteFields {
  /** Note value in 6-decimal USDC (u64). */
  value: bigint;
  /** Random blinding factor (prevents note correlation). */
  blinding: bigint;
  /** Recipient's APS address. */
  recipient: `0x${string}`;
  /** Optional application memo. */
  memo?: Uint8Array;
}

// ── Poseidon Hash ─────────────────────────────────────────────────────────────

/**
 * Poseidon hash over BN254 scalar field.
 * Used for note commitments and nullifiers.
 *
 * commitment = Poseidon(value, blinding, recipientPubKeyX)
 * nullifier  = Poseidon(commitment, identityPrivKey)
 *
 * Implementation: use @iden3/js-crypto or circomlibjs when APS launches.
 */
export async function poseidonHash(_inputs: bigint[]): Promise<bigint> {
  throw new ApsNotAvailableError("poseidonHash");
}

// ── Note Commitment ───────────────────────────────────────────────────────────

/**
 * Computes the note commitment for a set of note fields.
 * Committed to the APS merkle tree on deposit/receive.
 */
export async function computeNoteCommitment(_note: NoteFields): Promise<`0x${string}`> {
  throw new ApsNotAvailableError("computeNoteCommitment");
}

/**
 * Computes the nullifier for a note, which is revealed on spend.
 * Prevents double-spending without revealing which note was spent.
 */
export async function computeNullifier(
  _commitment: `0x${string}`,
  _identityPrivKey: `0x${string}`
): Promise<`0x${string}`> {
  throw new ApsNotAvailableError("computeNullifier");
}

// ── Note Encryption ───────────────────────────────────────────────────────────

/**
 * Encrypts a note to the recipient's public key.
 * The recipient can decrypt it using their private key.
 * An auditor with the viewing key can also decrypt.
 *
 * Steps (when APS is live):
 *  1. Generate ephemeral secp256k1 key pair.
 *  2. ECDH(ephemeralPrivKey, recipientPubKey) → shared secret.
 *  3. sharedKey = SHA-256(shared secret x-coordinate).
 *  4. AES-256-GCM encrypt the serialized note fields.
 */
export async function encryptNote(
  _note: NoteFields,
  _recipientPublicKey: Uint8Array
): Promise<EncryptedNote> {
  throw new ApsNotAvailableError("encryptNote");
}

/**
 * Decrypts a note using the recipient's (or viewer's) private key.
 * Returns null if the note is not addressed to this key.
 */
export async function decryptNote(
  _encrypted: EncryptedNote,
  _privateKey: Uint8Array
): Promise<NoteFields | null> {
  throw new ApsNotAvailableError("decryptNote");
}

/**
 * Scans a batch of encrypted notes and returns those decryptable by the key.
 * Used during identity restoration to recover the note set.
 *
 * @param notes     — encrypted notes from on-chain events
 * @param privateKey — identity or viewing key
 * @returns         — subset of notes decryptable by this key
 */
export async function scanNotes(
  _notes: EncryptedNote[],
  _privateKey: Uint8Array
): Promise<Array<{ index: number; fields: NoteFields }>> {
  throw new ApsNotAvailableError("scanNotes");
}

// ── Key Derivation ────────────────────────────────────────────────────────────

/**
 * Derives an APS spending key from an EOA private key.
 * Uses BIP-32 derivation path m/44'/60'/0'/0/aps.
 *
 * The spending key is used to sign zk-proofs and must be kept secret.
 * The viewing key is derived from the spending key and can be shared.
 */
export async function deriveApsKeys(_eoaPrivateKey: Uint8Array): Promise<{
  spendingKey: Uint8Array;
  viewingKey: Uint8Array;
  publicKey: Uint8Array;
}> {
  throw new ApsNotAvailableError("deriveApsKeys");
}
