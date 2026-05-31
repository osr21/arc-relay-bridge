---
name: YieldVault deployments
description: Deployed contract addresses for all YieldVault instances; update after re-deploy
---

YieldVault.sol compiled with solc 0.8.20, optimizer 200 runs. Bytecode embedded in `scripts/src/deployYield.ts`.

**Deployed 2026-05-31:**

| Chain | Chain ID | Address | APY bps |
|---|---|---|---|
| Arc Testnet | 5042002 | `0x586f6598755F17308CCf96254c935Ab4e08f71b2` | 1850 (18.5%) |
| Base Sepolia | 84532 | `0x6F80056564491425273A6a481EcC5DAea9D57f23` | 1230 (12.3%) |
| Avalanche Fuji | 43113 | `0x025B4eED9942A2d11B779c43Ff571Aa78eACB39a` | 920 (9.2%) |
| Ethereum Sepolia | 11155111 | NOT DEPLOYED — insufficient Sepolia ETH | 780 (7.8%) |

**Why:** Sepolia deployer balance was only 0.0016 ETH; deployment costs ~0.032 ETH. Fund deployer and re-run `pnpm --filter @workspace/scripts run deploy-yield` to deploy Sepolia vault.

**How to apply:** After re-deploying Sepolia, update `VAULT_ADDRESSES[11155111]` in `artifacts/arc-bridge/src/lib/yield.ts` and `vaultAddress` in `artifacts/api-server/src/routes/yield.ts`.

**Deployer wallet:** `0xdb5019b8DfbccEF8906C39B16a4870082eAbBc4C` (same as FeeRouter + GasRelayer deployer).
