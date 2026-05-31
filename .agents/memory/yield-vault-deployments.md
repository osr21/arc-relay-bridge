---
name: YieldVault deployments
description: Deployed contract addresses for all YieldVault instances; update after re-deploy
---

YieldVault.sol compiled with solc 0.8.20, optimizer 200 runs. Bytecode embedded in `scripts/src/deployYield.ts`.

**Deployed 2026-05-31 (all 4 chains):**

| Chain | Chain ID | Address | APY bps |
|---|---|---|---|
| Arc Testnet | 5042002 | `0x9677b4BB48B552E7042619056414Fe69d2b5e204` | 1850 (18.5%) |
| Ethereum Sepolia | 11155111 | `0xCD75dad98b3bC9bb3Bb153b623772967e77d56F1` | 780 (7.8%) |
| Base Sepolia | 84532 | `0xDE761A1b0FC1271AF2D1682158D428Bd12DC710d` | 1230 (12.3%) |
| Avalanche Fuji | 43113 | `0x57a298356E6B2A98d44C68Ff92B7372D639684E0` | 920 (9.2%) |

**Why:** All 4 fully deployed; Sepolia required ~0.032 ETH gas (second attempt after funding).

**How to apply:** To re-deploy, run `pnpm --filter @workspace/scripts run deploy-yield` then update `VAULT_ADDRESSES` in `artifacts/arc-bridge/src/lib/yield.ts` and `vaultAddress` fields in `artifacts/api-server/src/routes/yield.ts`.

**Deployer wallet:** `0xdb5019b8DfbccEF8906C39B16a4870082eAbBc4C` (same as FeeRouter + GasRelayer deployer).
