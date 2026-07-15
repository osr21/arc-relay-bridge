import { pgTable, text, bigint, index, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const memoEventsTable = pgTable(
  "memo_events",
  {
    id:           text("id").primaryKey(),          // txHash-memoIndex
    blockNumber:  bigint("block_number", { mode: "bigint" }).notNull(),
    blockTime:    timestamp("block_time", { withTimezone: true }).notNull(),
    txHash:       text("tx_hash").notNull(),
    sender:       text("sender").notNull(),          // preserved original sender
    target:       text("target").notNull(),          // contract called through memo
    callDataHash: text("call_data_hash").notNull(),  // keccak256 of inner calldata
    memoId:       text("memo_id").notNull(),         // application-defined bytes32
    memoData:     text("memo_data").notNull(),       // hex-encoded raw bytes
    memoText:     text("memo_text"),                 // UTF-8 decoded (null if binary)
    memoIndex:    bigint("memo_index", { mode: "bigint" }).notNull(),
    createdAt:    timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("memo_events_block_number_idx").on(t.blockNumber),
    index("memo_events_sender_idx").on(t.sender),
    index("memo_events_memo_id_idx").on(t.memoId),
    index("memo_events_tx_hash_idx").on(t.txHash),
  ]
);

export const insertMemoEventSchema = createInsertSchema(memoEventsTable);
export const selectMemoEventSchema = createSelectSchema(memoEventsTable);
export type InsertMemoEvent = z.infer<typeof insertMemoEventSchema>;
export type MemoEvent = typeof memoEventsTable.$inferSelect;
