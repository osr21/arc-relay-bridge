// Arc Subgraph — Memo event handler (AssemblyScript)
// Indexes Memo events from the Arc Memo contract (0x5294…e505).
//
// Memo event signature:
//   Memo(indexed address sender, indexed address target, bytes32 callDataHash,
//        indexed bytes32 memoId, bytes memo, uint256 memoIndex)

import { BigInt, Bytes, log } from "@graphprotocol/graph-ts";
import { Memo as MemoEvent_Evt } from "../../generated/MemoContract/Memo";
import { MemoEvent, AddressStats, IndexerMeta } from "../../generated/schema";

function getOrCreateStats(address: string, blockNumber: BigInt): AddressStats {
  let stats = AddressStats.load(address);
  if (!stats) {
    stats = new AddressStats(address);
    stats.address           = Bytes.fromHexString(address);
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

/**
 * Try to decode the memo bytes as UTF-8. Returns null if not valid text.
 * The Graph AS runtime exposes Bytes.toString() but it may throw on non-UTF-8.
 */
function tryDecodeUtf8(data: Bytes): string | null {
  // Simple heuristic: if any byte > 0x7e and < 0x80 skip decode
  // Real UTF-8 decode is done via Bytes.toString() in Graph AS
  const str = data.toString();
  // Check for replacement characters that indicate invalid UTF-8
  if (str.includes("\ufffd")) return null;
  return str;
}

export function handleMemo(event: MemoEvent_Evt): void {
  const sender = event.params.sender.toHexString().toLowerCase();
  const id = event.transaction.hash.toHexString() + "-" + event.params.memoIndex.toString();

  const memo = new MemoEvent(id);
  memo.blockNumber    = event.block.number;
  memo.blockTimestamp = event.block.timestamp;
  memo.txHash         = event.transaction.hash;
  memo.sender         = event.params.sender;
  memo.target         = event.params.target;
  memo.callDataHash   = event.params.callDataHash;
  memo.memoId         = event.params.memoId;
  memo.memoData       = event.params.memo;
  memo.memoText       = tryDecodeUtf8(event.params.memo);
  memo.memoIndex      = event.params.memoIndex;
  memo.save();

  // Update sender memo count
  const senderStats = getOrCreateStats(sender, event.block.number);
  senderStats.memoCount          = senderStats.memoCount.plus(BigInt.fromI32(1));
  senderStats.lastActivityBlock  = event.block.number;
  senderStats.save();

  // Update meta
  const meta = getOrCreateMeta();
  meta.totalMemos      = meta.totalMemos.plus(BigInt.fromI32(1));
  meta.lastIndexedBlock = event.block.number;
  meta.save();
}
