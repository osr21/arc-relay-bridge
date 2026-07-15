---
name: drpc.org free tier limits — Arc Testnet indexer
description: Three hard limits on arc-testnet.drpc.org that must all be respected; primary Arc RPC is too rate-limited to use for indexing.
---

## Rule

Use `https://arc-testnet.drpc.org` for ALL Arc RPC calls (block polling + getLogs). Never use `https://rpc.testnet.arc.network` for indexer work — it rate-limits even `eth_chainId` when called frequently.

Apply **all three** drpc.org free-tier limits simultaneously:

| Limit | Symptom | Fix |
|---|---|---|
| Max **10,000 blocks per getLogs range** (error code 35) | Backfill fails with "ranges over 10000 blocks not supported" | Keep `CCTP_HISTORY_WINDOW ≤ 9_000` |
| Max **3 requests per JSON-RPC batch** (error code 31) | Backfill or processBlock fails with "Batch of more than 3 requests" | Set `batchMaxCount: 1` in `JsonRpcProvider` options to disable ethers.js auto-batching |
| **Concurrent getBlock calls** saturate the endpoint | Block timestamp fetches fail during backfill | Limit concurrent `getBlock` calls to groups of 3 (not 20) in the backfill loop |

## How to apply

In `indexer.ts`:
```typescript
const PROVIDER_OPTS = { staticNetwork: true, batchMaxCount: 1 };
const provider = new ethers.JsonRpcProvider("https://arc-testnet.drpc.org", undefined, PROVIDER_OPTS);
```

For block timestamp fetching in backfill:
```typescript
for (let i = 0; i < blockNums.length; i += 3) { // groups of 3, not 20
  const batch = blockNums.slice(i, i + 3);
  const blocks = await Promise.all(batch.map(n => provider.getBlock(n)));
}
```

**Why:** All three failures look different in logs but stem from the same root cause — the drpc.org free tier has per-request, per-batch, and per-range limits that ethers.js v6's aggressive batching and concurrent Promise.all calls trip independently.
