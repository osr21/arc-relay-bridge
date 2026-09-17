---
name: Local EVM test timing
description: Why synchronous local mining needs uncached reads and receipt-aware assertions
---

For local EVM security tests, treat transaction submission and successful execution
as distinct outcomes. Verify receipts for writes; use a fresh state read or
static simulation when asserting a rejection after a just-mined transaction.

**Why:** Ethers briefly caches RPC operations. On a synchronously mining local
chain, repeating an identical transaction immediately after mining can reuse the
previous successful gas estimate. The transaction then broadcasts successfully
but reverts on-chain, so an assertion that only awaits submission reports the
wrong result. This is particularly misleading in replay-protection tests.

**How to apply:** Disable the provider's short cache for deterministic local tests
and ensure rejection helpers await receipts when their callback submits a
transaction. Do not equate an estimate or returned hash with an executed transfer.