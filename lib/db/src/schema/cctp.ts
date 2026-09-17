import { pgTable, text, bigint, integer, index, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const cctpBurnsTable = pgTable(
  "cctp_burns",
  {
    id:                text("id").primaryKey(),       // txHash-logIndex
    blockNumber:       bigint("block_number", { mode: "bigint" }).notNull(),
    blockTime:         timestamp("block_time", { withTimezone: true }).notNull(),
    txHash:            text("tx_hash").notNull(),
    sourceDomain:      integer("source_domain").notNull(),
    destinationDomain: integer("destination_domain").notNull(),
    burnToken:         text("burn_token").notNull(),
    amount:            text("amount").notNull(),      // 6-decimal bigint as string
    depositor:         text("depositor").notNull(),
    mintRecipient:     text("mint_recipient").notNull(), // bytes32 (padded address)
    nonce:             text("nonce").notNull(),
    destinationCaller: text("destination_caller").notNull(), // bytes32
    // PENDING | COMPLETE | STUCK (populated by attestation poller)
    attestationStatus: text("attestation_status").notNull().default("PENDING"),
    mintEventId:       text("mint_event_id"),         // FK to cctp_mints.id
    createdAt:         timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("cctp_burns_block_number_idx").on(t.blockNumber),
    index("cctp_burns_depositor_idx").on(t.depositor),
    index("cctp_burns_dest_domain_idx").on(t.destinationDomain),
    index("cctp_burns_attest_status_idx").on(t.attestationStatus),
    index("cctp_burns_nonce_idx").on(t.nonce),
  ]
);

export const cctpMintsTable = pgTable(
  "cctp_mints",
  {
    id:                text("id").primaryKey(),       // txHash-logIndex
    blockNumber:       bigint("block_number", { mode: "bigint" }).notNull(),
    blockTime:         timestamp("block_time", { withTimezone: true }).notNull(),
    txHash:            text("tx_hash").notNull(),
    destinationDomain: integer("destination_domain").notNull(),
    remoteDomain:      integer("remote_domain").notNull(),
    mintRecipient:     text("mint_recipient").notNull(),
    amount:            text("amount").notNull(),      // 6-decimal bigint as string
    mintToken:         text("mint_token").notNull(),
    nonce:             text("nonce").notNull(),
    burnEventId:       text("burn_event_id"),         // FK to cctp_burns.id (null if burn on other chain)
    createdAt:         timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("cctp_mints_block_number_idx").on(t.blockNumber),
    index("cctp_mints_recipient_idx").on(t.mintRecipient),
    index("cctp_mints_remote_domain_idx").on(t.remoteDomain),
    index("cctp_mints_nonce_idx").on(t.nonce),
  ]
);

export const insertCctpBurnSchema = createInsertSchema(cctpBurnsTable);
export const selectCctpBurnSchema = createSelectSchema(cctpBurnsTable);
export type InsertCctpBurn = z.infer<typeof insertCctpBurnSchema>;
export type CctpBurn = typeof cctpBurnsTable.$inferSelect;

export const insertCctpMintSchema = createInsertSchema(cctpMintsTable);
export const selectCctpMintSchema = createSelectSchema(cctpMintsTable);
export type InsertCctpMint = z.infer<typeof insertCctpMintSchema>;
export type CctpMint = typeof cctpMintsTable.$inferSelect;
