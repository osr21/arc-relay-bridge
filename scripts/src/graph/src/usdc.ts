// Arc Subgraph — USDC transfer handler (AssemblyScript)
// Handles native EIP-7708 Transfer events from 0xffff…fffe (18 decimals)
// and Approval/Blacklist events from the ERC-20 USDC contract.
//
// IMPORTANT: Do NOT index Transfer events from the ERC-20 contract (0x3600…0000)
// here — those are double-counted (each ERC-20 transfer also fires the native log).
// Use only the native emitter as the single source of truth for balance changes.

import { BigInt, BigDecimal, Bytes, log } from "@graphprotocol/graph-ts";
import { Transfer } from "../../generated/NativeUsdcEmitter/ERC20Transfer";
import {
  UsdcTransfer,
  AddressStats,
  IndexerMeta,
} from "../../generated/schema";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const NATIVE_DECIMALS_DIVISOR = BigDecimal.fromString("1000000000000"); // 1e12 → convert 18d to 6d

function getOrCreateStats(address: string, blockNumber: BigInt): AddressStats {
  let stats = AddressStats.load(address);
  if (!stats) {
    stats = new AddressStats(address);
    stats.address = Bytes.fromHexString(address);
    stats.totalReceivedNative = BigInt.zero();
    stats.totalSentNative = BigInt.zero();
    stats.transferCount = BigInt.zero();
    stats.memoCount = BigInt.zero();
    stats.cctpBurnCount = BigInt.zero();
    stats.cctpMintCount = BigInt.zero();
    stats.lastActivityBlock = blockNumber;
  }
  return stats;
}

function getOrCreateMeta(): IndexerMeta {
  let meta = IndexerMeta.load("meta");
  if (!meta) {
    meta = new IndexerMeta("meta");
    meta.lastIndexedBlock = BigInt.zero();
    meta.totalTransfers = BigInt.zero();
    meta.totalMemos = BigInt.zero();
    meta.totalCctpBurns = BigInt.zero();
    meta.totalCctpMints = BigInt.zero();
  }
  return meta;
}

function resolveTransferType(from: string, to: string): string {
  if (from == ZERO_ADDRESS) return "MINT";
  if (to   == ZERO_ADDRESS) return "BURN";
  return "NATIVE_SEND"; // native send; ERC-20 transfers also fire this but are the same flow
}

export function handleNativeTransfer(event: Transfer): void {
  const from = event.params.from.toHexString().toLowerCase();
  const to   = event.params.to.toHexString().toLowerCase();
  const value = event.params.value; // 18 decimals

  const id = event.transaction.hash.toHexString() + "-" + event.logIndex.toString();

  // Ignore self-transfers (protocol guarantees no log, but guard anyway)
  if (from == to) return;

  const transfer = new UsdcTransfer(id);
  transfer.blockNumber    = event.block.number;
  transfer.blockTimestamp = event.block.timestamp;
  transfer.txHash         = event.transaction.hash;
  transfer.logIndex       = event.logIndex;
  transfer.from           = event.params.from;
  transfer.to             = event.params.to;
  transfer.amountNative   = value;
  transfer.amountUsdc     = value.toBigDecimal().div(NATIVE_DECIMALS_DIVISOR);
  transfer.transferType   = resolveTransferType(from, to);
  transfer.isNativeLog    = true;
  transfer.save();

  // Update sender stats
  if (from != ZERO_ADDRESS) {
    const senderStats = getOrCreateStats(from, event.block.number);
    senderStats.totalSentNative  = senderStats.totalSentNative.plus(value);
    senderStats.transferCount    = senderStats.transferCount.plus(BigInt.fromI32(1));
    senderStats.lastActivityBlock = event.block.number;
    senderStats.save();
  }

  // Update recipient stats
  if (to != ZERO_ADDRESS) {
    const recipientStats = getOrCreateStats(to, event.block.number);
    recipientStats.totalReceivedNative = recipientStats.totalReceivedNative.plus(value);
    recipientStats.transferCount       = recipientStats.transferCount.plus(BigInt.fromI32(1));
    recipientStats.lastActivityBlock   = event.block.number;
    recipientStats.save();
  }

  // Update meta
  const meta = getOrCreateMeta();
  meta.totalTransfers    = meta.totalTransfers.plus(BigInt.fromI32(1));
  meta.lastIndexedBlock  = event.block.number;
  meta.save();
}

// Approval events — log only, no entity needed for base analytics
export function handleApproval(_event: any): void {
  // no-op — extend if you need approval tracking
}

export function handleBlacklisted(_event: any): void {
  // no-op — extend to maintain a BlocklistedAddress entity if needed
}

export function handleUnBlacklisted(_event: any): void {
  // no-op
}
