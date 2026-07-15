---
name: drizzle-kit BigInt default serialization
description: drizzle-kit crashes when schema has bigint columns with .default(0n); fix is mode:"number"
---

## Rule
Do NOT use `bigint("col", { mode: "bigint" }).default(0n)` in any drizzle schema — drizzle-kit@0.31.10 crashes during `push` with `TypeError: Do not know how to serialize a BigInt`.

**Why:** drizzle-kit internally calls `JSON.stringify` when diffing schema snapshots. The `0n` BigInt literal cannot be serialized.

**How to apply:**
- For counter/progress columns (indexer state, totals): use `bigint("col", { mode: "number" }).default(0)` — returns JS number, safe up to 2^53.
- For actual chain data (block numbers stored from BigInt RPC values): use `mode: "bigint"` with NO default; provide the value explicitly on insert.
- Alternative: `mode: "string"` stores and returns as a decimal string, avoids serialization on both drizzle-kit and Express JSON sides.
