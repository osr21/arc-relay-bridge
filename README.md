# Arc Relay Bridge

**A production-grade cross-chain USDC bridge built on Circle's CCTP V2, targeting Arc Testnet.**

Move native USDC between Arc, Ethereum Sepolia, Base Sepolia, and Avalanche Fuji — no wrapped tokens, no liquidity pools, no ETH needed for gas. Built as a sample application for the [Arc ecosystem](https://docs.arc.io).

---

## What it does

| Feature | Description |
|---|---|
| **Cross-Chain Bridge** | Burn USDC on any chain, natively mint on the destination. Pure CCTP V2 — 1:1, no slippage. |
| **Gas Relay** | Enable relay mode to bridge without holding destination-chain gas. GasRelayer covers the mint fee from the transferred amount. |
| **Gasless Mode** | ERC-4337 smart account bridge — pay gas in USDC, not ETH. |
| **Yield Vaults** | Deposit USDC into on-chain yield vaults. Arc Testnet: 18.5% APY. |
| **USDC Paymaster** | The first deployed USDC-denominated ERC-4337 v0.7 paymaster on Arc Testnet. Pre-fund gas for smart-account ops. |
| **Gas Refuel** | Spend Arc USDC to receive native ETH or AVAX on other chains. |
| **Portfolio View** | See your USDC across all 4 chains in one unified view. One-click "Bridge to Arc" from any chain. |

---

## Why this app matters for Arc

Arc is Circle's own L1 with USDC as its native gas token. For the ecosystem to grow, users and developers need:

1. **A bridge** — Move USDC from established chains onto Arc. This is that bridge.
2. **Gas bootstrapping** — New Arc users can't pay for the CCTP mint without first having Arc USDC. The GasRelayer solves this chicken-and-egg problem.
3. **An ERC-4337 reference** — Arc's AA docs list providers but have no reference USDC paymaster. This app's Paymaster is the first one deployed on Arc Testnet.
4. **A CCTP V2 reference** — The full 7-param `depositForBurn` flow, per-chain `minFinalityThreshold`, and Iris attestation polling are all demonstrated in `src/lib/bridge.ts`.

This app is a **standalone UI complement** to Circle's [App Kit SDK](https://www.npmjs.com/package/@circle-fin/app-kit) — App Kit for developers embedding bridging in their own apps, Arc Relay Bridge for users arriving directly. See `/developers` for side-by-side code comparisons.

---

## Pages

| Route | Description |
|---|---|
| `/` | Cross-chain USDC bridge (CCTP V2, Gas Relay, Gasless modes) |
| `/portfolio` | Unified USDC balance view across all 4 chains |
| `/yield` | USDC yield vaults — compare and deposit across chains |
| `/paymaster` | ERC-4337 USDC Paymaster — deposit and manage gas balance |
| `/refuel` | Spend Arc USDC to receive native gas on other chains |
| `/ecosystem` | About this app — Arc ecosystem positioning and feature overview |
| `/developers` | Embed in your app — Circle App Kit + raw CCTP code snippets |

---

## Supported chains (Testnet)

| Chain | CCTP Domain | Chain ID | RPC |
|---|---|---|---|
| Arc Testnet | 26 | 5042002 | `https://rpc.testnet.arc.network` |
| Ethereum Sepolia | 0 | 11155111 | `https://ethereum-sepolia-rpc.publicnode.com` |
| Base Sepolia | 6 | 84532 | `https://sepolia.base.org` |
| Avalanche Fuji | 1 | 43113 | `https://api.avax-test.network/ext/bc/C/rpc` |

---

## Deployed contracts (v6-hardened, 2026-06-16)

### CCTP V2 (same on all chains)
| Contract | Address |
|---|---|
| TokenMessenger | `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA` |
| MessageTransmitter | `0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275` |

### USDC Paymaster (ERC-4337 v0.7)
| Chain | Address |
|---|---|
| Arc Testnet | `0xEE39e1690F1bE07e8a68813f57cE3142197CECf6` |
| Ethereum Sepolia | `0xe7ED22eF9Af9CAd98B048979dbd726e89dd0D417` |
| Base Sepolia | `0x5f309aE9A9A364Ae18af77b7733bB9C43A032A4A` |
| Avalanche Fuji | `0x0D3B7bd972F4Cc3CDAB62E1cFafcA79F8d7167f5` |

### GasRelayer
| Chain | Address |
|---|---|
| Arc Testnet | `0xf89773D7d9C43c01203793bf991e2550975a0C49` |
| Ethereum Sepolia | `0x5eA2A91629245074D01EFf64fc223233c2a805E6` |
| Base Sepolia | `0x5bE70628f49aFb90D81d169bff1533F437B967BB` |
| Avalanche Fuji | `0x53183000a7Ae24AE9F1126271a66Eff1161a58Ec` |

### YieldVault
| Chain | Address | APY |
|---|---|---|
| Arc Testnet | `0xFf8f0Fc1Cca51ddE49ee1E7083D36CC99Af01665` | 18.5% |
| Ethereum Sepolia | `0xd4a11E7C3512A5c9C09E0296bB06490244476673` | 7.8% |
| Base Sepolia | `0x0D3B7bd972F4Cc3CDAB62E1cFafcA79F8d7167f5` | 12.3% |
| Avalanche Fuji | `0xEE39e1690F1bE07e8a68813f57cE3142197CECf6` | 9.2% |

---

## Run locally

```bash
pnpm install
pnpm --filter @workspace/arc-bridge run dev
```

Get testnet USDC from [faucet.circle.com](https://faucet.circle.com), add Arc Testnet to MetaMask (Chain ID `5042002`, RPC `https://rpc.testnet.arc.network`), and bridge.

---

## Key links

- [Arc Docs](https://docs.arc.io)
- [Arc Developer Discord](https://discord.com/invite/buildonarc)
- [Circle CCTP V2](https://developers.circle.com/stablecoins/cctp-getting-started)
- [Circle App Kit](https://docs.arc.io/app-kit)
- [Circle Faucet](https://faucet.circle.com)
- [Arc Testnet Explorer](https://testnet.arcscan.app)
