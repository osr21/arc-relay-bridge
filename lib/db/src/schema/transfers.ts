import { pgTable, text, bigint, boolean, index, timestamp, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const usdcTransfersTable = pgTable(
  "usdc_transfers",
  {
    id:           text("id").primaryKey(),          // txHash-logIndex
    blockNumber:  bigint("block_number", { mode: "bigint" }).notNull(),
    blockTime:    timestamp("block_time", { withTimezone: true }).notNull(),
    txHash:       text("tx_hash").notNull(),
    logIndex:     bigint("log_index", { mode: "bigint" }).notNull(),
    fromAddress:  text("from_address").notNull(),
    toAddress:    text("to_address").notNull(),
    amountNative: text("amount_native").notNull(),  // 18-decimal bigint as string
    amountUsdc:   numeric("amount_usdc", { precision: 28, scale: 6 }).notNull(), // 6-decimal
    transferType: text("transfer_type").notNull(),  // NATIVE_SEND | ERC20_TRANSFER | MINT | BURN
    isNativeLog:  boolean("is_native_log").notNull(),
    createdAt:    timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("usdc_transfers_block_number_idx").on(t.blockNumber),
    index("usdc_transfers_from_idx").on(t.fromAddress),
    index("usdc_transfers_to_idx").on(t.toAddress),
    index("usdc_transfers_tx_hash_idx").on(t.txHash),
  ]
);

export const insertUsdcTransferSchema = createInsertSchema(usdcTransfersTable);
export const selectUsdcTransferSchema = createSelectSchema(usdcTransfersTable);
export type InsertUsdcTransfer = z.infer<typeof insertUsdcTransferSchema>;
export type UsdcTransfer = typeof usdcTransfersTable.$inferSelect;
