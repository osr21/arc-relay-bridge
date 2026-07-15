/**
 * Indexer API Routes (Tools A + B + E)
 *
 * Exposes indexed Arc event data via REST:
 *   GET /api/indexer/transfers    — USDC transfer history
 *   GET /api/indexer/memos        — Transaction memo history
 *   GET /api/indexer/cctp/burns   — CCTP v2 burn events
 *   GET /api/indexer/cctp/mints   — CCTP v2 mint events
 *   GET /api/indexer/stats        — Aggregate indexer stats
 */

import { Router } from "express";
import { db, usdcTransfersTable, memoEventsTable, cctpBurnsTable, cctpMintsTable, indexerStateTable } from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";

const router = Router();

// ── Validation helpers ────────────────────────────────────────────────────────

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/i;
const HASH_RE    = /^0x[0-9a-fA-F]{64}$/i;
const VALID_TRANSFER_TYPES = new Set(["NATIVE_SEND", "MINT", "BURN"]);
const VALID_BURN_STATUSES  = new Set(["PENDING", "COMPLETE", "STUCK"]);

function parsePagination(query: Record<string, unknown>): { limit: number; offset: number } {
  const rawLimit = parseInt(String(query.limit ?? "25"), 10);
  const rawPage  = parseInt(String(query.page  ?? "1"),  10);
  const limit = Math.min(isNaN(rawLimit) || rawLimit < 1 ? 25 : rawLimit, 100);
  const page  = isNaN(rawPage)  || rawPage  < 1 ? 1 : rawPage;
  return { limit, offset: (page - 1) * limit };
}

/** Parse a CCTP domain number; returns null if missing or not a safe integer. */
function parseDomain(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const n = parseInt(String(value), 10);
  return isNaN(n) || !Number.isSafeInteger(n) ? null : n;
}

// ── GET /api/indexer/transfers ────────────────────────────────────────────────

router.get("/indexer/transfers", async (req, res) => {
  const { limit, offset } = parsePagination(req.query as Record<string, unknown>);
  const fromRaw   = req.query.from   as string | undefined;
  const toRaw     = req.query.to     as string | undefined;
  const typeRaw   = req.query.type   as string | undefined;
  const txHashRaw = req.query.txHash as string | undefined;

  if (fromRaw !== undefined && !ADDRESS_RE.test(fromRaw)) {
    res.status(400).json({ error: "Invalid 'from' address" });
    return;
  }
  if (toRaw !== undefined && !ADDRESS_RE.test(toRaw)) {
    res.status(400).json({ error: "Invalid 'to' address" });
    return;
  }
  if (txHashRaw !== undefined && !HASH_RE.test(txHashRaw)) {
    res.status(400).json({ error: "Invalid 'txHash'" });
    return;
  }
  if (typeRaw !== undefined && !VALID_TRANSFER_TYPES.has(typeRaw.toUpperCase())) {
    res.status(400).json({ error: `Invalid 'type' — must be one of: ${[...VALID_TRANSFER_TYPES].join(", ")}` });
    return;
  }

  const from   = fromRaw?.toLowerCase();
  const to     = toRaw?.toLowerCase();
  const txHash = txHashRaw?.toLowerCase();
  const type   = typeRaw?.toUpperCase();

  const conditions = [];
  if (from)   conditions.push(eq(usdcTransfersTable.fromAddress, from));
  if (to)     conditions.push(eq(usdcTransfersTable.toAddress, to));
  if (type)   conditions.push(eq(usdcTransfersTable.transferType, type));
  if (txHash) conditions.push(eq(usdcTransfersTable.txHash, txHash));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, [countRow]] = await Promise.all([
    db.select().from(usdcTransfersTable)
      .where(where)
      .orderBy(desc(usdcTransfersTable.blockNumber), desc(usdcTransfersTable.logIndex))
      .limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)::int` }).from(usdcTransfersTable).where(where),
  ]);

  res.json({
    data:  rows,
    total: countRow.count,
    page:  Math.floor(offset / limit) + 1,
    limit,
  });
});

// ── GET /api/indexer/memos ────────────────────────────────────────────────────

router.get("/indexer/memos", async (req, res) => {
  const { limit, offset } = parsePagination(req.query as Record<string, unknown>);
  const senderRaw = req.query.sender as string | undefined;
  const targetRaw = req.query.target as string | undefined;
  const memoId    = req.query.memoId as string | undefined;
  const txHashRaw = req.query.txHash as string | undefined;

  if (senderRaw !== undefined && !ADDRESS_RE.test(senderRaw)) {
    res.status(400).json({ error: "Invalid 'sender' address" });
    return;
  }
  if (targetRaw !== undefined && !ADDRESS_RE.test(targetRaw)) {
    res.status(400).json({ error: "Invalid 'target' address" });
    return;
  }
  if (txHashRaw !== undefined && !HASH_RE.test(txHashRaw)) {
    res.status(400).json({ error: "Invalid 'txHash'" });
    return;
  }

  const sender = senderRaw?.toLowerCase();
  const target = targetRaw?.toLowerCase();
  const txHash = txHashRaw?.toLowerCase();

  const conditions = [];
  if (sender) conditions.push(eq(memoEventsTable.sender, sender));
  if (target) conditions.push(eq(memoEventsTable.target, target));
  if (memoId) conditions.push(eq(memoEventsTable.memoId, memoId));
  if (txHash) conditions.push(eq(memoEventsTable.txHash, txHash));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, [countRow]] = await Promise.all([
    db.select().from(memoEventsTable)
      .where(where)
      .orderBy(desc(memoEventsTable.blockNumber), desc(memoEventsTable.memoIndex))
      .limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)::int` }).from(memoEventsTable).where(where),
  ]);

  res.json({
    data:  rows,
    total: countRow.count,
    page:  Math.floor(offset / limit) + 1,
    limit,
  });
});

// ── GET /api/indexer/cctp/burns ───────────────────────────────────────────────

router.get("/indexer/cctp/burns", async (req, res) => {
  const { limit, offset } = parsePagination(req.query as Record<string, unknown>);
  const depositorRaw = req.query.depositor as string | undefined;
  const destDomainRaw = req.query.destDomain as string | undefined;
  const statusRaw     = req.query.status    as string | undefined;

  if (depositorRaw !== undefined && !ADDRESS_RE.test(depositorRaw)) {
    res.status(400).json({ error: "Invalid 'depositor' address" });
    return;
  }
  if (destDomainRaw !== undefined && parseDomain(destDomainRaw) === null) {
    res.status(400).json({ error: "Invalid 'destDomain' — must be an integer" });
    return;
  }
  if (statusRaw !== undefined && !VALID_BURN_STATUSES.has(statusRaw.toUpperCase())) {
    res.status(400).json({ error: `Invalid 'status' — must be one of: ${[...VALID_BURN_STATUSES].join(", ")}` });
    return;
  }

  const depositor  = depositorRaw?.toLowerCase();
  const destDomain = parseDomain(destDomainRaw);
  const status     = statusRaw?.toUpperCase();

  const conditions = [];
  if (depositor !== undefined)  conditions.push(eq(cctpBurnsTable.depositor, depositor));
  if (destDomain !== null)      conditions.push(eq(cctpBurnsTable.destinationDomain, destDomain));
  if (status !== undefined)     conditions.push(eq(cctpBurnsTable.attestationStatus, status));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, [countRow]] = await Promise.all([
    db.select().from(cctpBurnsTable)
      .where(where)
      .orderBy(desc(cctpBurnsTable.blockNumber))
      .limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)::int` }).from(cctpBurnsTable).where(where),
  ]);

  res.json({
    data:  rows,
    total: countRow.count,
    page:  Math.floor(offset / limit) + 1,
    limit,
  });
});

// ── GET /api/indexer/cctp/mints ───────────────────────────────────────────────

router.get("/indexer/cctp/mints", async (req, res) => {
  const { limit, offset } = parsePagination(req.query as Record<string, unknown>);
  const recipientRaw   = req.query.recipient   as string | undefined;
  const remoteDomainRaw = req.query.remoteDomain as string | undefined;

  if (recipientRaw !== undefined && !ADDRESS_RE.test(recipientRaw)) {
    res.status(400).json({ error: "Invalid 'recipient' address" });
    return;
  }
  if (remoteDomainRaw !== undefined && parseDomain(remoteDomainRaw) === null) {
    res.status(400).json({ error: "Invalid 'remoteDomain' — must be an integer" });
    return;
  }

  const recipient    = recipientRaw?.toLowerCase();
  const remoteDomain = parseDomain(remoteDomainRaw);

  const conditions = [];
  if (recipient !== undefined)    conditions.push(eq(cctpMintsTable.mintRecipient, recipient));
  if (remoteDomain !== null)      conditions.push(eq(cctpMintsTable.remoteDomain, remoteDomain));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, [countRow]] = await Promise.all([
    db.select().from(cctpMintsTable)
      .where(where)
      .orderBy(desc(cctpMintsTable.blockNumber))
      .limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)::int` }).from(cctpMintsTable).where(where),
  ]);

  res.json({
    data:  rows,
    total: countRow.count,
    page:  Math.floor(offset / limit) + 1,
    limit,
  });
});

// ── GET /api/indexer/stats ────────────────────────────────────────────────────

router.get("/indexer/stats", async (_req, res) => {
  const [state, recentBurns, recentMints] = await Promise.all([
    db.select().from(indexerStateTable).limit(1),
    db.select({
      destDomain: cctpBurnsTable.destinationDomain,
      count:      sql<number>`count(*)::int`,
      totalAmount: sql<string>`sum(amount::numeric)::text`,
    }).from(cctpBurnsTable)
      .groupBy(cctpBurnsTable.destinationDomain)
      .orderBy(desc(sql`count(*)`)),
    db.select({
      remoteDomain: cctpMintsTable.remoteDomain,
      count:        sql<number>`count(*)::int`,
      totalAmount:  sql<string>`sum(amount::numeric)::text`,
    }).from(cctpMintsTable)
      .groupBy(cctpMintsTable.remoteDomain)
      .orderBy(desc(sql`count(*)`)),
  ]);

  const DOMAIN_NAMES: Record<number, string> = {
    0: "Ethereum Sepolia",
    1: "Avalanche Fuji",
    6: "Base Sepolia",
    26: "Arc Testnet",
  };

  res.json({
    indexer:  state[0] ?? null,
    cctpBurnsByDestination: recentBurns.map(r => ({
      ...r,
      domainName: DOMAIN_NAMES[r.destDomain] ?? `Domain ${r.destDomain}`,
    })),
    cctpMintsBySource: recentMints.map(r => ({
      ...r,
      domainName: DOMAIN_NAMES[r.remoteDomain] ?? `Domain ${r.remoteDomain}`,
    })),
  });
});

export default router;
