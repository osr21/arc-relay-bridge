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
import { eq, and, desc, sql, or } from "drizzle-orm";

const router = Router();

// ── Pagination helper ─────────────────────────────────────────────────────────

function parsePagination(query: Record<string, unknown>): { limit: number; offset: number } {
  const limit  = Math.min(Number(query.limit  ?? 25), 100);
  const page   = Math.max(Number(query.page   ?? 1), 1);
  return { limit, offset: (page - 1) * limit };
}

// ── GET /api/indexer/transfers ────────────────────────────────────────────────

router.get("/indexer/transfers", async (req, res) => {
  const { limit, offset } = parsePagination(req.query as Record<string, unknown>);
  const from   = (req.query.from   as string | undefined)?.toLowerCase();
  const to     = (req.query.to     as string | undefined)?.toLowerCase();
  const type   = req.query.type   as string | undefined;
  const txHash = req.query.txHash as string | undefined;

  const conditions = [];
  if (from)   conditions.push(eq(usdcTransfersTable.fromAddress, from));
  if (to)     conditions.push(eq(usdcTransfersTable.toAddress, to));
  if (type)   conditions.push(eq(usdcTransfersTable.transferType, type.toUpperCase()));
  if (txHash) conditions.push(eq(usdcTransfersTable.txHash, txHash.toLowerCase()));

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
  const sender = (req.query.sender as string | undefined)?.toLowerCase();
  const target = (req.query.target as string | undefined)?.toLowerCase();
  const memoId = req.query.memoId as string | undefined;
  const txHash = req.query.txHash as string | undefined;

  const conditions = [];
  if (sender) conditions.push(eq(memoEventsTable.sender, sender));
  if (target) conditions.push(eq(memoEventsTable.target, target));
  if (memoId) conditions.push(eq(memoEventsTable.memoId, memoId));
  if (txHash) conditions.push(eq(memoEventsTable.txHash, txHash.toLowerCase()));

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
  const depositor = (req.query.depositor as string | undefined)?.toLowerCase();
  const destDomain = req.query.destDomain as string | undefined;
  const status    = req.query.status     as string | undefined;

  const conditions = [];
  if (depositor)  conditions.push(eq(cctpBurnsTable.depositor, depositor));
  if (destDomain) conditions.push(eq(cctpBurnsTable.destinationDomain, Number(destDomain)));
  if (status)     conditions.push(eq(cctpBurnsTable.attestationStatus, status.toUpperCase()));

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
  const recipient   = (req.query.recipient as string | undefined)?.toLowerCase();
  const remoteDomain = req.query.remoteDomain as string | undefined;

  const conditions = [];
  if (recipient)    conditions.push(eq(cctpMintsTable.mintRecipient, recipient));
  if (remoteDomain) conditions.push(eq(cctpMintsTable.remoteDomain, Number(remoteDomain)));

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
