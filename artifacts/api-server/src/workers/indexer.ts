/**
 * Arc Event Indexer Worker (Tools A + B)
 *
 * Polls Arc Testnet every 2s and indexes:
 *   A. Native USDC transfers (EIP-7708 from 0xffff…fffe, 18 decimals)
 *   B. Transaction memo events (0x5294…e505 Memo contract)
 *   E. CCTP v2 burns (TokenMessenger) and mints (MessageTransmitter)
 *
 * Arc-specific indexing facts:
 *  - Block time ~0.48s — no reorgs, deterministic finality
 *  - Use block.number (not block.timestamp) as ordering key
 *  - Native emitter 0xffff…fffe is single source of truth for USDC balance changes
 *  - An ERC-20 transfer() fires TWO logs (native + ERC-20); we index ONLY native
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

const ARC_RPC  = "https://rpc.testnet.arc.network";
const CHAIN_ID = "arc-testnet";

const NATIVE_USDC_EMITTER = "0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFE";
const MEMO_CONTRACT       = "0x5294E9927c3306DcBaDb03fe70b92e01cCede505";
const TOKEN_MESSENGER     = "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA";
const MSG_TRANSMITTER     = "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275";
const ARC_CCTP_DOMAIN     = 26;

const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

const MEMO_IFACE = new Interface([
  "event Memo(address indexed sender, address indexed target, bytes32 callDataHash, bytes32 indexed memoId, bytes memo, uint256 memoIndex)",
]);
const TOKEN_MESSENGER_IFACE = new Interface([
  "event DepositForBurn(uint64 indexed nonce, address burnToken, uint256 amount, address indexed depositor, bytes32 mintRecipient, uint32 destinationDomain, bytes32 destinationTokenMessenger, bytes32 destinationCaller)",
]);
const MSG_TRANSMITTER_IFACE = new Interface([
  "event MessageReceived(address indexed caller, uint32 sourceDomain, uint64 indexed nonce, bytes32 sender, bytes message)",
]);
const ERC20_IFACE = new Interface([
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

const MEMO_TOPIC         = MEMO_IFACE.getEvent("Memo")!.topicHash;
const DEPOSIT_BURN_TOPIC = TOKEN_MESSENGER_IFACE.getEvent("DepositForBurn")!.topicHash;
const MSG_RECEIVED_TOPIC = MSG_TRANSMITTER_IFACE.getEvent("MessageReceived")!.topicHash;

// ── State ─────────────────────────────────────────────────────────────────────

let lastIndexedBlock = 0;
let isRunning = false;

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

// ── Block processor ───────────────────────────────────────────────────────────

async function processBlock(
  provider: ethers.JsonRpcProvider,
  blockNumber: number
): Promise<void> {
  // Fetch all relevant logs in parallel per address
  const [nativeLogs, memoLogs, burnLogs, mintLogs] = await Promise.all([
    provider.getLogs({ address: NATIVE_USDC_EMITTER, topics: [TRANSFER_TOPIC], fromBlock: blockNumber, toBlock: blockNumber }),
    provider.getLogs({ address: MEMO_CONTRACT,        topics: [MEMO_TOPIC],         fromBlock: blockNumber, toBlock: blockNumber }),
    provider.getLogs({ address: TOKEN_MESSENGER,      topics: [DEPOSIT_BURN_TOPIC], fromBlock: blockNumber, toBlock: blockNumber }),
    provider.getLogs({ address: MSG_TRANSMITTER,      topics: [MSG_RECEIVED_TOPIC], fromBlock: blockNumber, toBlock: blockNumber }),
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

    // ── E. CCTP Burns ─────────────────────────────────────────────────────
    for (const log of burnLogs) {
      const parsed = TOKEN_MESSENGER_IFACE.parseLog({ topics: [...log.topics], data: log.data });
      if (!parsed) continue;

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

    // ── E. CCTP Mints ─────────────────────────────────────────────────────
    for (const log of mintLogs) {
      const parsed = MSG_TRANSMITTER_IFACE.parseLog({ topics: [...log.topics], data: log.data });
      if (!parsed) continue;

      const nonce     = parsed.args.nonce as bigint;
      const srcDomain = parsed.args.sourceDomain as number;
      const msgBytes  = Buffer.from((parsed.args.message as string).replace(/^0x/, ""), "hex");

      let amount = 0n;
      let mintRecipient = "0x0000000000000000000000000000000000000000";
      const mintToken   = "0x3600000000000000000000000000000000000000";

      try {
        if (msgBytes.length >= 216) {
          const bodyOffset = 116;
          const mintRecipientBytes = msgBytes.subarray(bodyOffset + 36, bodyOffset + 68);
          mintRecipient = "0x" + mintRecipientBytes.subarray(12).toString("hex");
          const amountBytes = msgBytes.subarray(bodyOffset + 68, bodyOffset + 100);
          amount = BigInt("0x" + amountBytes.toString("hex"));
        }
      } catch (e) {
        logger.warn({ err: e, nonce: nonce.toString() }, "indexer: CCTP message decode failed");
      }

      const id = `${log.transactionHash}-${log.index}`;
      await tx.insert(cctpMintsTable).values({
        id,
        blockNumber:       BigInt(blockNumber),
        blockTime:         ts,
        txHash:            log.transactionHash,
        destinationDomain: ARC_CCTP_DOMAIN,
        remoteDomain:      srcDomain,
        mintRecipient:     mintRecipient.toLowerCase(),
        amount:            amount.toString(),
        mintToken,
        nonce:             nonce.toString(),
      }).onConflictDoNothing();

      // Link to burn event if it was on Arc
      if (srcDomain === ARC_CCTP_DOMAIN) {
        await tx.update(cctpBurnsTable)
          .set({ mintEventId: id, attestationStatus: "COMPLETE" })
          .where(eq(cctpBurnsTable.nonce, nonce.toString()));
      }

      mintCount++;
    }

    // ── Update indexer state (mode: "number") ─────────────────────────────
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

  const provider = new ethers.JsonRpcProvider(ARC_RPC, undefined, { staticNetwork: true });

  // Catch up on missed blocks (cap at 500 on first start)
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

  // Poll every 2s — covers ~4 Arc blocks per cycle
  let errorCount = 0;
  setInterval(() => {
    void (async () => {
      try {
        const latest = await provider.getBlockNumber();
        if (latest > lastIndexedBlock) {
          for (let b = lastIndexedBlock + 1; b <= latest; b++) {
            await processBlock(provider, b);
            lastIndexedBlock = b;
          }
        }
        errorCount = 0;
      } catch (e) {
        errorCount++;
        logger.error({ err: e, errorCount }, "indexer: poll error");
      }
    })();
  }, 2000);

  logger.info("indexer: polling Arc Testnet every 2s");
}
