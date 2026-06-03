# Arc Relay Bridge

  A cross-chain USDC bridge built on [Circle's CCTP V2](https://developers.circle.com/stablecoins/cctp-getting-started), deployable to Arc Testnet. Burn USDC on a source chain and natively mint it on the destination — no wrapped tokens, no liquidity pools.

  [![Live App](https://img.shields.io/badge/Live%20App-arc--relay--bridge.replit.app-blue)](https://arc-relay-bridge.replit.app)

  ---

  ## Features

  - **Native USDC bridging** via Circle CCTP V2 — 1:1, no slippage, no wrapped tokens
  - **ERC-4337 gasless burn** (Beta) — bridge without native tokens using our USDC Paymaster
  - **Gasless mint relay** — skip the wallet-switch step on arrival for a 1 USDC relay fee
  - **4-step progress UI** — Approve → Burn → Attest → Mint with real-time status
  - **Session resume** — interrupted bridges can be resumed from the burn transaction hash
  - **Multi-chain** — Arc Testnet ↔ Ethereum Sepolia, Base Sepolia, Avalanche Fuji

  ---

  ## Supported Chains

  | Chain | CCTP Domain | Chain ID | minFinalityThreshold |
  |---|---|---|---|
  | Arc Testnet | 26 | 5042002 | 2000 (finalized) |
  | Ethereum Sepolia | 0 | 11155111 | 1000 (safe, ~1–3 min) |
  | Base Sepolia | 6 | 84532 | 1000 (safe, ~1–3 min) |
  | Avalanche Fuji | 1 | 43113 | 1000 (safe, ~1–3 min) |

  ---

  ## Contract Addresses

  > All CCTP V2 contracts are deployed at the **same address on every chain**.

  | Contract | Address |
  |---|---|
  | TokenMessenger (CCTP V2) | `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA` |
  | MessageTransmitter (CCTP V2) | `0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275` |

  | Chain | USDC Address |
  |---|---|
  | Arc Testnet | `0x3600000000000000000000000000000000000000` |
  | Ethereum Sepolia | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` |
  | Base Sepolia | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
  | Avalanche Fuji | `0x5425890298aed601595a70AB815c96711a31Bc65` |

  ### Paymaster v5 (ERC-4337 v0.7)

  Deployed 2026-06-01. Compiled with `evmVersion: "paris"` for Arc/Fuji compatibility.

  | Chain | Address |
  |---|---|
  | Arc Testnet | `0xfD06D288d481515a986DF28030AF013De290D76C` |
  | Ethereum Sepolia | `0xC9E9ba0bfE58FA438B8B6f2182d3ADA3669F9Eb4` |
  | Base Sepolia | `0xe355E9dCdEAB37eA8fd81b9457Ad2C56d3eE9055` |
  | Avalanche Fuji | `0x7C75A75B59b63871e1Bb47fA63e541F0e5975f93` |

  ### FeeRouter v2

  Deployed 2026-05-23. Hardened: immutable addresses, reentrancy lock, zero-recipient guard.

  | Chain | Address |
  |---|---|
  | Arc Testnet | `0x8256a1e1f8971448b49dA0F55b8A1BB6557eA8FC` |
  | Ethereum Sepolia | `0x5B1F511ed4dF76f369671BF1c4aCF0dD84CC0804` |
  | Base Sepolia | `0x8d4B57eD464df10414Dde3ADC2E403a01ebc50d8` |
  | Avalanche Fuji | `0x64D160b7E91e78e52dFc0e8829640E32A919164C` |

  ---

  ## Quick Start

  ```bash
  pnpm install
  pnpm --filter @workspace/arc-bridge run dev   # bridge frontend
  pnpm run typecheck                             # full typecheck
  pnpm run build                                 # build all packages
  ```

  ---

  ## Architecture

  The bridge is **frontend-only** — all logic runs client-side via ethers.js + MetaMask.

  ```
  User EOA (MetaMask)
      │
      ├─ Standard bridge
      │     └─ approve → depositForBurn → poll Iris API → receiveMessage
      │
      └─ ERC-4337 gasless
            ├─ Smart account (SimpleAccount, same address on every chain)
            │     └─ approve + depositForBurn (batched UserOp)
            ├─ Paymaster gas vault (USDC replaces native tokens for gas)
            └─ Pimlico bundler → EntryPoint v0.7
  ```

  ### Key decisions

  - **CCTP V2 only** — 7-param `depositForBurn` (selector `0x8e0250ee`). V1 selector reverts.
  - **Arc USDC uses 6 decimals** via ERC-20 interface (native representation is 18 dec for gas only).
  - **Gasless USDC source** — the smart account's own wallet. The Paymaster gas vault covers gas fees only, not the bridge amount.
  - **`entryPoint` is `constant`** — keeps single-slot `0x60a0` init; 2-immutable `0x60c0` silently reverts on Arc/Base/Fuji.
  - **No `nonReentrant` on `validatePaymasterUserOp`** — ERC-7562 forbids global storage writes for unstaked paymasters.

  ---

  ## Stack

  | Layer | Technology |
  |---|---|
  | Frontend | React 19 + Vite + Tailwind CSS + shadcn/ui |
  | Web3 | ethers.js v6 |
  | ERC-4337 | permissionless v0.3.6 + viem v2.51.3 |
  | Bundler | Pimlico (testnet) |
  | Protocol | Circle CCTP V2 |
  | Attestation | Circle Iris API (sandbox) |
  | Monorepo | pnpm workspaces + Node.js 24 + TypeScript 5.9 |

  ---

  ## Documentation

  | File | Description |
  |---|---|
  | [Overview](docs/overview.md) | Product overview and bridge flow |
  | [User Guide](docs/user-guide.md) | Step-by-step usage and ERC-4337 setup |
  | [Paymaster](docs/paymaster.md) | Paymaster architecture, flow, deployment |
  | [Technical Reference](docs/technical-reference.md) | Addresses, ABIs, RPCs |
  | [Development](docs/development.md) | Local setup, scripts, gotchas |
  | [Changelog](CHANGELOG.md) | Release history and bug fixes |

  ---

  ## Known Gotchas

  - **ALL chains use CCTP V2** — V1 4-param selector will revert.
  - **Arc USDC** is a special system address — always use ERC-20 interface (6 dec).
  - **Arc explorer**: `https://testnet.arcscan.app` — previous URLs are dead.
  - **Sepolia RPC**: use `publicnode.com` — `rpc.sepolia.org` is unreliable.
  - **Paymaster gas vault ≠ smart account wallet** — the vault covers gas, not the bridge amount.
  - **Base Sepolia gasless** needs a one-time gas vault deposit before first bridge.

  ---

  ## Links

  - [Circle Faucet (testnet USDC)](https://faucet.circle.com)
  - [Arc Docs](https://docs.arc.io)
  - [CCTP Docs](https://developers.circle.com/stablecoins/cctp-getting-started)
  - [Arc Testnet Explorer](https://testnet.arcscan.app)
  - [Sepolia Etherscan](https://sepolia.etherscan.io)
  - [Base Sepolia Explorer](https://sepolia.basescan.org)
  - [Fuji Explorer](https://testnet.snowtrace.io)
  