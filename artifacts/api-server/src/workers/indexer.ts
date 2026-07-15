/**
 * Arc Event Indexer Worker (Tools A + B)
 *
 * Polls Arc Testnet every 2s and indexes:
 *   A. Native USDC transfers (EIP-7708 from 0xffff…fffe, 18 decimals)
 *   B. Transaction memo events (0x5294…e505 Memo contract)
 *   E. CCTP v2 burns (TokenMessenger DepositForBurn) and mints (TokenMessenger MintAndWithdraw)
 *
 * Arc-specific indexing facts:
 *  - Block time ~0.48s — no reorgs, deterministic finality
 *  - Use block.number (not block.timestamp) as ordering key
 *  - Native emitter 0xffff…fffe is single source of truth for USDC balance changes
 *  - An ERC-20 transfer() fires TWO logs (native + ERC-20); we index ONLY native
 *  - Arc CCTP V2 DepositForBurn: indexed params are burnToken, depositor, nonce (not V1 order)
 *  - Arc CCTP V2 DepositForBurn topic: 0x0c8c1cbdc5190613ebd485511d4e2812cfa45eecb79d845893331fedad5130a5
 *  - Primary Arc RPC rate-limits eth_getLogs (-32011); use drpc.org for all getLogs calls
 */

import { ethers, Interface } from "ethers";
import { logger } from "../lib/logger";
import {
  db,
  usdcTransfersTable,
  memoEventsTable,
  cctpBurnsTable,
  cctpMintsTable,
  indexerStateTable,
} from "@workspace/db";
import { eq, sql } from "drizzle-orm";

// ── Constants ─────────────────────────────────────────────────────────────────

// drpc.org is the only reliable Arc RPC: the primary rpc.testnet.arc.network rate-limits
// both eth_getLogs (-32011) and general requests. drpc.org free tier supports up to 10,000
// block ranges per getLogs call and has no per-request rate limit for polling.
const ARC_RPC      = "https://arc-testnet.drpc.org"; // all RPC calls (block polling + getLogs)
const ARC_LOGS_RPC = "https://arc-testnet.drpc.org"; // same endpoint; kept separate for clarity
const CHAIN_ID     = "arc-testnet";

const NATIVE_USDC_EMITTER = "0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFE";
const MEMO_CONTRACT       = "0x5294E9927c3306DcBaDb03fe70b92e01cCede505";
const TOKEN_MESSENGER     = "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA";
const MSG_TRANSMITTER     = "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275";
const ARC_CCTP_DOMAIN     = 26;

// How many blocks to scan back on startup for CCTP history
// drpc.org free tier caps getLogs at 10,000 blocks per range call — keep this under the limit
const CCTP_HISTORY_WINDOW = 9_000;

const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

// CCTP V2 MessageReceived topic (4 topics, 3 indexed: caller, bytes32 hash, nonce)
// Data layout (non-indexed): [sourceDomain uint32 word0] [sender bytes32 word1] [bytes offset word2] [bytes...]]
// We only need word0 (sourceDomain) — no full ABI required.
const MSG_RECEIVED_V2_TOPIC = "0xff48c13eda96b1cceacc6b9edeedc9e9db9d6226afbc30146b720c19d3addb1c";

const MEMO_IFACE = new Interface([
  "event Memo(address indexed sender, address indexed target, bytes32 callDataHash, bytes32 indexed memoId, bytes memo, uint256 memoIndex)",
]);

// Arc CCTP V2 TokenMessenger events — confirmed from on-chain data (July 2026)
// DepositForBurn: burnToken, depositor, nonce are the three indexed params (Arc-specific ordering)
// topic: 0x0c8c1cbdc5190613ebd485511d4e2812cfa45eecb79d845893331fedad5130a5
// MintAndWithdraw: mintRecipient, mintToken indexed
// topic: 0x50c55e915134d457debfa58eb6f4342956f8b0616d51a89a3659360178e1ab63
const TOKEN_MESSENGER_IFACE = new Interface([
  "event DepositForBurn(address indexed burnToken, uint256 amount, address indexed depositor, bytes32 mintRecipient, uint32 destinationDomain, bytes32 destinationTokenMessenger, bytes32 destinationCaller, uint256 indexed nonce, uint32 minFinalityThreshold, bytes hookData)",
  "event MintAndWithdraw(address indexed mintRecipient, uint256 amount, address indexed mintToken, uint256 nonce)",
]);

const ERC20_IFACE = new Interface([
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

const MEMO_TOPIC              = MEMO_IFACE.getEvent("Memo")!.topicHash;
const DEPOSIT_BURN_TOPIC      = TOKEN_MESSENGER_IFACE.getEvent("DepositForBurn")!.topicHash;
const MINT_AND_WITHDRAW_TOPIC = TOKEN_MESSENGER_IFACE.getEvent("MintAndWithdraw")!.topicHash;

// drpc.org free tier: max 3 requests per JSON-RPC batch.
// ethers.js v6 batches all concurrent requests by default — disable that.
const PROVIDER_OPTS: ethers.JsonRpcApiProviderOptions = { staticNetwork: true, batchMaxCount: 1 };

// Maximum blocks to process per polling tick; keeps each 2 s interval from
// blocking for hours when catching up from a large gap.
const MAX_BLOCKS_PER_TICK = 100;

// ── State ─────────────────────────────────────────────────────────────────────

let lastIndexedBlock = 0;
let isRunning = false;
let isTicking  = false; // guard against overlapping poll ticks

// ── Helpers ───────────────────────────────────────────────────────────────────

function transferType(from: string, to: string): string {
  const ZERO = "0x0000000000000000000000000000000000000000";
  if (from.toLowerCase() === ZERO) return "MINT";
  if (to.toLowerCase()   === ZERO) return "BURN";
  return "NATIVE_SEND";
}

function tryUtf8(hex: string): string | null {
  try {
    const bytes = Buffer.from(hex.replace(/^0x/, ""), "hex");
    const text  = bytes.toString("utf8");
    if (/\uFFFD/.test(text)) return null;
    return text;
  } catch {
    return null;
  }
}

/**
 * Extract sourceDomain from a raw MessageReceived V2 event data field.
 * Non-indexed data layout: [word0=sourceDomain(uint32)] [word1=sender(bytes32)] [word2=offset] [bytes...]
 */
function parseSourceDomain(rawData: string): number {
  if (rawData.length < 66) return 0;
  // word0 is the first 32 bytes (64 hex chars after '0x'); sourceDomain occupies the last 4 bytes
  const word0 = rawData.slice(2, 66);
  return parseInt(word0.slice(56), 16); // last 8 hex chars = uint32
}

// ── Block processor ───────────────────────────────────────────────────────────

async function processBlock(
  provider:    ethers.JsonRpcProvider,
  blockNumber: number
): Promise<void> {
  const [nativeLogs, memoLogs, burnLogs, mintLogs, msgLogs] = await Promise.all([
    provider.getLogs({ address: NATIVE_USDC_EMITTER, topics: [TRANSFER_TOPIC],          fromBlock: blockNumber, toBlock: blockNumber }),
    provider.getLogs({ address: MEMO_CONTRACT,        topics: [MEMO_TOPIC],              fromBlock: blockNumber, toBlock: blockNumber }),
    provider.getLogs({ address: TOKEN_MESSENGER,      topics: [DEPOSIT_BURN_TOPIC],      fromBlock: blockNumber, toBlock: blockNumber }),
    provider.getLogs({ address: TOKEN_MESSENGER,      topics: [MINT_AND_WITHDRAW_TOPIC], fromBlock: blockNumber, toBlock: blockNumber }),
    provider.getLogs({ address: MSG_TRANSMITTER,      topics: [MSG_RECEIVED_V2_TOPIC],   fromBlock: blockNumber, toBlock: blockNumber }),
  ]);

  if (nativeLogs.length + memoLogs.length + burnLogs.length + mintLogs.length === 0) {
    return;
  }

  const block = await provider.getBlock(blockNumber);
  if (!block) {
    logger.warn({ blockNumber }, "indexer: block not found, skipping");
    return;
  }
  const ts = new Date(Number(block.timestamp) * 1000);

  await db.transaction(async (tx) => {
    let transferCount = 0;
    let memoCount     = 0;
    let burnCount     = 0;
    let mintCount     = 0;

    // ── A. Native USDC Transfers ──────────────────────────────────────────
    for (const log of nativeLogs) {
      const parsed = ERC20_IFACE.parseLog({ topics: [...log.topics], data: log.data });
      if (!parsed) continue;

      const from  = (parsed.args.from as string).toLowerCase();
      const to    = (parsed.args.to   as string).toLowerCase();
      const value = parsed.args.value as bigint;

      if (from === to) continue;

      const id = `${log.transactionHash}-${log.index}`;
      await tx.insert(usdcTransfersTable).values({
        id,
        blockNumber:  BigInt(blockNumber),
        blockTime:    ts,
        txHash:       log.transactionHash,
        logIndex:     BigInt(log.index),
        fromAddress:  from,
        toAddress:    to,
        amountNative: value.toString(),
        amountUsdc:   (value / 1_000_000_000_000n).toString(),
        transferType: transferType(from, to),
        isNativeLog:  true,
      }).onConflictDoNothing();

      transferCount++;
    }

    // ── B. Memo Events ────────────────────────────────────────────────────
    for (const log of memoLogs) {
      const parsed = MEMO_IFACE.parseLog({ topics: [...log.topics], data: log.data });
      if (!parsed) continue;

      const sender    = (parsed.args.sender as string).toLowerCase();
      const target    = (parsed.args.target as string).toLowerCase();
      const memoIndex = parsed.args.memoIndex as bigint;
      const rawMemo   = parsed.args.memo as string;

      const id = `${log.transactionHash}-${memoIndex.toString()}`;
      await tx.insert(memoEventsTable).values({
        id,
        blockNumber:  BigInt(blockNumber),
        blockTime:    ts,
        txHash:       log.transactionHash,
        sender,
        target,
        callDataHash: parsed.args.callDataHash as string,
        memoId:       parsed.args.memoId as string,
        memoData:     rawMemo,
        memoText:     tryUtf8(rawMemo),
        memoIndex:    memoIndex,
      }).onConflictDoNothing();

      memoCount++;
    }

    // ── E. CCTP Burns (DepositForBurn from TokenMessenger) ────────────────
    for (const log of burnLogs) {
      const parsed = TOKEN_MESSENGER_IFACE.parseLog({ topics: [...log.topics], data: log.data });
      if (!parsed || parsed.name !== "DepositForBurn") continue;

      const id = `${log.transactionHash}-${log.index}`;
      await tx.insert(cctpBurnsTable).values({
        id,
        blockNumber:       BigInt(blockNumber),
        blockTime:         ts,
        txHash:            log.transactionHash,
        sourceDomain:      ARC_CCTP_DOMAIN,
        destinationDomain: parsed.args.destinationDomain as number,
        burnToken:         (parsed.args.burnToken as string).toLowerCase(),
        amount:            (parsed.args.amount as bigint).toString(),
        depositor:         (parsed.args.depositor as string).toLowerCase(),
        mintRecipient:     parsed.args.mintRecipient as string,
        nonce:             (parsed.args.nonce as bigint).toString(),
        destinationCaller: parsed.args.destinationCaller as string,
        attestationStatus: "PENDING",
      }).onConflictDoNothing();

      burnCount++;
    }

    // ── E. CCTP Mints (MintAndWithdraw from TokenMessenger) ──────────────
    for (const log of mintLogs) {
      const parsed = TOKEN_MESSENGER_IFACE.parseLog({ topics: [...log.topics], data: log.data });
      if (!parsed || parsed.name !== "MintAndWithdraw") continue;

      const mintRecipient = (parsed.args.mintRecipient as string).toLowerCase();
      const amount        = parsed.args.amount as bigint;
      const mintToken     = (parsed.args.mintToken as string).toLowerCase();
      const nonce         = parsed.args.nonce as bigint;

      // Obtain sourceDomain from the MessageReceived V2 log in the same transaction
      const msgLog      = msgLogs.find(l => l.transactionHash === log.transactionHash);
      const remoteDomain = msgLog ? parseSourceDomain(msgLog.data) : 0;

      const id = `${log.transactionHash}-${log.index}`;
      await tx.insert(cctpMintsTable).values({
        id,
        blockNumber:       BigInt(blockNumber),
        blockTime:         ts,
        txHash:            log.transactionHash,
        destinationDomain: ARC_CCTP_DOMAIN,
        remoteDomain,
        mintRecipient,
        amount:            amount.toString(),
        mintToken,
        nonce:             nonce.toString(),
      }).onConflictDoNothing();

      mintCount++;
    }

    // ── Update indexer state ──────────────────────────────────────────────
    await tx.insert(indexerStateTable).values({
      id:               CHAIN_ID,
      lastIndexedBlock: blockNumber,
      totalTransfers:   transferCount,
      totalMemos:       memoCount,
      totalCctpBurns:   burnCount,
      totalCctpMints:   mintCount,
      updatedAt:        new Date(),
    }).onConflictDoUpdate({
      target: [indexerStateTable.id],
      set: {
        lastIndexedBlock: blockNumber,
        totalTransfers:   sql`${indexerStateTable.totalTransfers} + ${transferCount}`,
        totalMemos:       sql`${indexerStateTable.totalMemos} + ${memoCount}`,
        totalCctpBurns:   sql`${indexerStateTable.totalCctpBurns} + ${burnCount}`,
        totalCctpMints:   sql`${indexerStateTable.totalCctpMints} + ${mintCount}`,
        updatedAt:        new Date(),
      },
    });
  });

  logger.info({
    blockNumber,
    transfers: nativeLogs.length,
    memos:     memoLogs.length,
    cctpBurns: burnLogs.length,
    cctpMints: mintLogs.length,
  }, "indexer: block indexed");
}

// ── CCTP Historical Backfill ──────────────────────────────────────────────────

/**
 * Range-based getLogs scan for CCTP events.
 * Uses a single getLogs call per event type across the full range — much more
 * efficient than per-block polling for historical data.
 */
async function backfillCctpHistory(
  provider:     ethers.JsonRpcProvider,
  logsProvider: ethers.JsonRpcProvider,
  fromBlock:    number,
  toBlock:      number
): Promise<void> {
  logger.info({ fromBlock, toBlock }, "indexer: CCTP backfill starting");

  const [burnLogs, mintLogs, msgLogs] = await Promise.all([
    logsProvider.getLogs({ address: TOKEN_MESSENGER, topics: [DEPOSIT_BURN_TOPIC],      fromBlock, toBlock }),
    logsProvider.getLogs({ address: TOKEN_MESSENGER, topics: [MINT_AND_WITHDRAW_TOPIC], fromBlock, toBlock }),
    logsProvider.getLogs({ address: MSG_TRANSMITTER, topics: [MSG_RECEIVED_V2_TOPIC],   fromBlock, toBlock }),
  ]);

  if (burnLogs.length === 0 && mintLogs.length === 0) {
    logger.info("indexer: CCTP backfill — no events found in range");
    return;
  }

  logger.info({ burns: burnLogs.length, mints: mintLogs.length }, "indexer: CCTP backfill events found");

  // Fetch unique blocks (needed for timestamps)
  const blockNums = [...new Set([
    ...burnLogs.map(l => l.blockNumber),
    ...mintLogs.map(l => l.blockNumber),
  ])];

  // drpc.org free tier: batch concurrent getBlock calls in groups of 3
  // (more than 3 concurrent requests triggers the batch limit even without JSON-RPC batching)
  const blockMap = new Map<number, Date>();
  for (let i = 0; i < blockNums.length; i += 3) {
    const batch = blockNums.slice(i, i + 3);
    const blocks = await Promise.all(batch.map(n => provider.getBlock(n)));
    for (const blk of blocks) {
      if (blk) blockMap.set(blk.number, new Date(Number(blk.timestamp) * 1000));
    }
  }

  // Process in DB transaction
  await db.transaction(async (tx) => {
    let burnCount = 0;
    let mintCount = 0;

    for (const log of burnLogs) {
      const parsed = TOKEN_MESSENGER_IFACE.parseLog({ topics: [...log.topics], data: log.data });
      if (!parsed || parsed.name !== "DepositForBurn") continue;

      const ts = blockMap.get(log.blockNumber) ?? new Date();
      const id = `${log.transactionHash}-${log.index}`;
      await tx.insert(cctpBurnsTable).values({
        id,
        blockNumber:       BigInt(log.blockNumber),
        blockTime:         ts,
        txHash:            log.transactionHash,
        sourceDomain:      ARC_CCTP_DOMAIN,
        destinationDomain: parsed.args.destinationDomain as number,
        burnToken:         (parsed.args.burnToken as string).toLowerCase(),
        amount:            (parsed.args.amount as bigint).toString(),
        depositor:         (parsed.args.depositor as string).toLowerCase(),
        mintRecipient:     parsed.args.mintRecipient as string,
        nonce:             (parsed.args.nonce as bigint).toString(),
        destinationCaller: parsed.args.destinationCaller as string,
        attestationStatus: "PENDING",
      }).onConflictDoNothing();
      burnCount++;
    }

    for (const log of mintLogs) {
      const parsed = TOKEN_MESSENGER_IFACE.parseLog({ topics: [...log.topics], data: log.data });
      if (!parsed || parsed.name !== "MintAndWithdraw") continue;

      const ts           = blockMap.get(log.blockNumber) ?? new Date();
      const mintRecipient = (parsed.args.mintRecipient as string).toLowerCase();
      const amount        = parsed.args.amount as bigint;
      const mintToken     = (parsed.args.mintToken as string).toLowerCase();
      const nonce         = parsed.args.nonce as bigint;

      const msgLog      = msgLogs.find(l => l.transactionHash === log.transactionHash);
      const remoteDomain = msgLog ? parseSourceDomain(msgLog.data) : 0;

      const id = `${log.transactionHash}-${log.index}`;
      await tx.insert(cctpMintsTable).values({
        id,
        blockNumber:       BigInt(log.blockNumber),
        blockTime:         ts,
        txHash:            log.transactionHash,
        destinationDomain: ARC_CCTP_DOMAIN,
        remoteDomain,
        mintRecipient,
        amount:            amount.toString(),
        mintToken,
        nonce:             nonce.toString(),
      }).onConflictDoNothing();
      mintCount++;
    }

    logger.info({ burnCount, mintCount }, "indexer: CCTP backfill inserted");
  });
}

// ── Startup ───────────────────────────────────────────────────────────────────

async function getResumeBlock(provider: ethers.JsonRpcProvider): Promise<number> {
  try {
    const state = await db.select().from(indexerStateTable)
      .where(eq(indexerStateTable.id, CHAIN_ID)).limit(1);
    if (state.length > 0 && state[0].lastIndexedBlock > 0) {
      const resume = state[0].lastIndexedBlock + 1;
      logger.info({ resumeBlock: resume }, "indexer: resuming from DB");
      return resume;
    }
  } catch (e) {
    logger.warn({ err: e }, "indexer: could not read resume block, using latest");
  }
  return await provider.getBlockNumber();
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function startIndexer(): Promise<void> {
  if (isRunning) return;
  isRunning = true;

  logger.info("indexer: starting Arc Testnet event indexer");

  // Single provider for everything — drpc.org handles both getLogs and block calls.
  // batchMaxCount:1 prevents ethers.js from bundling calls into a JSON-RPC batch
  // (drpc.org free tier rejects batches of > 3 requests with error code 31).
  const provider = new ethers.JsonRpcProvider(ARC_RPC, undefined, PROVIDER_OPTS);

  // CCTP backfill: scan the last CCTP_HISTORY_WINDOW blocks for historical burn/mint events.
  // Uses range-based getLogs (1 call per event type) — far more efficient than per-block polling.
  // drpc.org free tier limit: 10,000 blocks per getLogs range → CCTP_HISTORY_WINDOW = 9,000.
  try {
    const latestBlock  = await provider.getBlockNumber();
    const backfillFrom = Math.max(0, latestBlock - CCTP_HISTORY_WINDOW);
    await backfillCctpHistory(provider, provider, backfillFrom, latestBlock);
  } catch (e) {
    logger.error({ err: e }, "indexer: CCTP backfill error (non-fatal, continuing)");
  }

  // Catch up on missed blocks (cap at 500 on first start to return quickly)
  try {
    const resumeBlock = await getResumeBlock(provider);
    const latestBlock = await provider.getBlockNumber();
    lastIndexedBlock  = Math.max(resumeBlock - 1, 0);

    if (resumeBlock <= latestBlock) {
      const gap       = latestBlock - resumeBlock;
      const catchUpTo = resumeBlock + Math.min(gap, 500);
      logger.info({ gap, from: resumeBlock, to: catchUpTo }, "indexer: catching up");
      for (let b = resumeBlock; b <= catchUpTo; b++) {
        await processBlock(provider, b);
        lastIndexedBlock = b;
      }
    }
  } catch (e) {
    logger.error({ err: e }, "indexer: catch-up error");
  }

  // Poll every 2 s — covers ~4 Arc blocks per cycle.
  // isTicking guard prevents overlapping ticks when processing a large backlog.
  // MAX_BLOCKS_PER_TICK caps per-tick work so a large gap (e.g. 35k blocks after
  // restart) is processed gradually (~100 blocks / 2 s ≈ 12 min to close 35k gap)
  // rather than blocking the event loop for hours.
  let errorCount = 0;
  setInterval(() => {
    if (isTicking) return;
    isTicking = true;
    void (async () => {
      try {
        const latest = await provider.getBlockNumber();
        if (latest > lastIndexedBlock) {
          const to = Math.min(latest, lastIndexedBlock + MAX_BLOCKS_PER_TICK);
          for (let b = lastIndexedBlock + 1; b <= to; b++) {
            await processBlock(provider, b);
            lastIndexedBlock = b;
          }
        }
        errorCount = 0;
      } catch (e) {
        errorCount++;
        logger.error({ err: e, errorCount }, "indexer: poll error");
      } finally {
        isTicking = false;
      }
    })();
  }, 2000);

  logger.info("indexer: polling Arc Testnet every 2s");
}
