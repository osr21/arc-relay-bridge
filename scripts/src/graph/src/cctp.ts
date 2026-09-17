// Arc Subgraph — CCTP v2 event handlers (AssemblyScript)
//
// TokenMessenger: DepositForBurn(uint64 nonce, address burnToken, uint256 amount,
//   address depositor, bytes32 mintRecipient, uint32 destinationDomain,
//   bytes32 destinationTokenMessenger, bytes32 destinationCaller)
//
// MessageTransmitter: MessageReceived(address caller, uint32 sourceDomain,
//   uint64 nonce, bytes32 sender, bytes message)
//
// Arc Testnet domain = 26

import { BigInt, Bytes, log } from "@graphprotocol/graph-ts";
import { DepositForBurn } from "../../generated/TokenMessenger/TokenMessenger";
import { MessageReceived } from "../../generated/MessageTransmitter/MessageTransmitter";
import { CctpBurn, CctpMint, AddressStats, IndexerMeta } from "../../generated/schema";

const ARC_DOMAIN = 26;

function getOrCreateStats(address: string, blockNumber: BigInt): AddressStats {
  let stats = AddressStats.load(address);
  if (!stats) {
    stats = new AddressStats(address);
    stats.address             = Bytes.fromHexString(address);
    stats.totalReceivedNative = BigInt.zero();
    stats.totalSentNative     = BigInt.zero();
    stats.transferCount       = BigInt.zero();
    stats.memoCount           = BigInt.zero();
    stats.cctpBurnCount       = BigInt.zero();
    stats.cctpMintCount       = BigInt.zero();
    stats.lastActivityBlock   = blockNumber;
  }
  return stats;
}

function getOrCreateMeta(): IndexerMeta {
  let meta = IndexerMeta.load("meta");
  if (!meta) {
    meta = new IndexerMeta("meta");
    meta.lastIndexedBlock = BigInt.zero();
    meta.totalTransfers   = BigInt.zero();
    meta.totalMemos       = BigInt.zero();
    meta.totalCctpBurns   = BigInt.zero();
    meta.totalCctpMints   = BigInt.zero();
  }
  return meta;
}

export function handleDepositForBurn(event: DepositForBurn): void {
  const depositor = event.params.depositor.toHexString().toLowerCase();
  const id = event.transaction.hash.toHexString() + "-" + event.logIndex.toString();

  const burn = new CctpBurn(id);
  burn.blockNumber        = event.block.number;
  burn.blockTimestamp     = event.block.timestamp;
  burn.txHash             = event.transaction.hash;
  burn.sourceDomain       = ARC_DOMAIN;
  burn.destinationDomain  = event.params.destinationDomain;
  burn.burnToken          = event.params.burnToken;
  burn.amount             = event.params.amount;
  burn.depositor          = event.params.depositor;
  burn.mintRecipient      = event.params.mintRecipient;
  burn.nonce              = event.params.nonce;
  burn.destinationCaller  = event.params.destinationCaller;
  burn.attestationStatus  = "PENDING";
  burn.mintEvent          = null;
  burn.save();

  const stats = getOrCreateStats(depositor, event.block.number);
  stats.cctpBurnCount      = stats.cctpBurnCount.plus(BigInt.fromI32(1));
  stats.lastActivityBlock  = event.block.number;
  stats.save();

  const meta = getOrCreateMeta();
  meta.totalCctpBurns   = meta.totalCctpBurns.plus(BigInt.fromI32(1));
  meta.lastIndexedBlock = event.block.number;
  meta.save();
}

/**
 * MessageReceived fires on the destination chain when receiveMessage() succeeds.
 * We parse the CCTP message bytes to extract nonce + recipient for linking.
 *
 * CCTP v2 message layout (bytes):
 *   [0..3]   version (4 bytes)
 *   [4..7]   sourceDomain (4 bytes)
 *   [8..11]  destinationDomain (4 bytes)
 *   [12..19] nonce (8 bytes)
 *   [20..51] sender (32 bytes)
 *   [52..83] recipient (32 bytes, last 20 = address)
 *   [84..115] destinationCaller (32 bytes)
 *   [116..]  messageBody (variable)
 *
 * messageBody for TokenMessenger transfers starts with:
 *   [0..3]   burnMessageVersion
 *   [4..35]  burnToken (32 bytes)
 *   [36..67] mintRecipient (32 bytes)
 *   [68..99] amount (32 bytes, uint256)
 *   [100..131] messageSender (32 bytes)
 */
export function handleMessageReceived(event: MessageReceived): void {
  const id = event.transaction.hash.toHexString() + "-" + event.logIndex.toString();

  // Parse source domain and nonce from the raw message bytes
  const msgBytes = event.params.message;
  // sourceDomain: bytes 4-7
  const sourceDomain = msgBytes[4] << 24 | msgBytes[5] << 16 | msgBytes[6] << 8 | msgBytes[7];
  // nonce from event (uint64)
  const nonce = event.params.nonce;

  // Parse amount from messageBody (offset 116 + 68 = 184, 32 bytes)
  let amount = BigInt.zero();
  if (msgBytes.length >= 216) {
    // Simple big-endian decode for the 32-byte amount field
    // (Graph AS doesn't have built-in BigInt parsing from bytes, so we approximate)
    // For production, use a proper bytes-to-BigInt helper
    amount = BigInt.fromUnsignedBytes(
      Bytes.fromUint8Array(msgBytes.slice(184, 216).reverse() as Uint8Array)
    );
  }

  // Extract mintRecipient: messageBody bytes 36-67 (absolute: 116+36=152 to 152+32=184)
  const recipientBytes = msgBytes.slice(152, 184);
  const recipient = Bytes.fromUint8Array(recipientBytes as Uint8Array);
  const recipientAddr = "0x" + recipient.toHexString().slice(-40); // last 20 bytes

  const mint = new CctpMint(id);
  mint.blockNumber        = event.block.number;
  mint.blockTimestamp     = event.block.timestamp;
  mint.txHash             = event.transaction.hash;
  mint.destinationDomain  = ARC_DOMAIN;
  mint.remoteDomain       = sourceDomain;
  mint.mintRecipient      = Bytes.fromHexString(recipientAddr);
  mint.amount             = amount;
  mint.mintToken          = Bytes.fromHexString("0x3600000000000000000000000000000000000000");
  mint.nonce              = nonce;

  // Try to link to burn event by nonce (may be null if burn on another chain subgraph)
  const burnSearchId = nonce.toString() + "-" + sourceDomain.toString();
  mint.burnEvent = null; // cross-chain linking requires a cross-subgraph query
  mint.save();

  const stats = getOrCreateStats(recipientAddr.toLowerCase(), event.block.number);
  stats.cctpMintCount     = stats.cctpMintCount.plus(BigInt.fromI32(1));
  stats.lastActivityBlock = event.block.number;
  stats.save();

  const meta = getOrCreateMeta();
  meta.totalCctpMints   = meta.totalCctpMints.plus(BigInt.fromI32(1));
  meta.lastIndexedBlock = event.block.number;
  meta.save();
}
