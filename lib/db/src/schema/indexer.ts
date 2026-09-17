import { pgTable, text, bigint, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Singleton row (id = "arc-testnet") tracking the indexer's progress.
 * Uses mode:"number" so drizzle-kit can serialize the schema — Arc block
 * numbers won't exceed Number.MAX_SAFE_INTEGER for many years.
 */
export const indexerStateTable = pgTable("indexer_state", {
  id:               text("id").primaryKey(),
  lastIndexedBlock: bigint("last_indexed_block", { mode: "number" }).notNull().default(0),
  totalTransfers:   bigint("total_transfers",    { mode: "number" }).notNull().default(0),
  totalMemos:       bigint("total_memos",        { mode: "number" }).notNull().default(0),
  totalCctpBurns:   bigint("total_cctp_burns",   { mode: "number" }).notNull().default(0),
  totalCctpMints:   bigint("total_cctp_mints",   { mode: "number" }).notNull().default(0),
  updatedAt:        timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertIndexerStateSchema = createInsertSchema(indexerStateTable);
export const selectIndexerStateSchema = createSelectSchema(indexerStateTable);
export type InsertIndexerState = z.infer<typeof insertIndexerStateSchema>;
export type IndexerState = typeof indexerStateTable.$inferSelect;
