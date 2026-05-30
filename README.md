# Arc Relay Bridge

  A cross-chain USDC bridge built on [Circle's CCTP V2](https://developers.circle.com/stablecoins/cctp-getting-started), deployable to Arc Testnet. Burn USDC on a source chain and natively mint it on the destination — no wrapped tokens, no liquidity pools.

  **Live:** [arc-relay-bridge.replit.app](https://arc-relay-bridge.replit.app)

  ---

  ## Features

  - **CCTP V2 burn-and-mint** — 1:1 native USDC on both ends, no intermediary
  - **Gasless relay** — bridge without holding destination-chain gas (1 USDC flat fee)
  - **0.3% protocol fee** — collected on the source chain before the burn
  - **4-step progress UI** — Approve → Fee → Burn → Attest → Mint/Relay
  - **Session recovery** — interrupted transfers resume automatically on reload
  - **Multi-chain** — Arc Testnet ↔ Ethereum Sepolia, Base Sepolia, Avalanche Fuji

  ---

  ## Supported Chains (Testnet)

  | Chain | CCTP Domain | Chain ID | Min Finality Threshold |
  |---|---|---|---|
  | Arc Testnet | 26 | 5042002 | 2000 (finalized) |
  | Ethereum Sepolia | 0 | 11155111 | 1000 (safe) |
  | Base Sepolia | 6 | 84532 | 1000 (safe) |
  | Avalanche Fuji | 1 | 43113 | 1000 (safe) |

  ---

  ## Contract Addresses

  ### CCTP V2 (same on all chains)

  | Contract | Address |
  |---|---|
  | TokenMessenger | `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA` |
  | MessageTransmitter | `0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275` |

  ### USDC

  | Chain | Address |
  |---|---|
  | Arc Testnet | `0x3600000000000000000000000000000000000000` |
  | Ethereum Sepolia | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` |
  | Base Sepolia | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
  | Avalanche Fuji | `0x5425890298aed601595a70AB815c96711a31Bc65` |

  ### FeeRouter v2 (deployed 2025-05-23)

  Collects the 0.3% protocol fee on each bridge. Immutable USDC/TokenMessenger references, reentrancy lock, zero-recipient checks.

  | Chain | Address |
  |---|---|
  | Arc Testnet | `0x8256a1e1f8971448b49dA0F55b8A1BB6557eA8FC` |
  | Ethereum Sepolia | `0x5B1F511ed4dF76f369671BF1c4aCF0dD84CC0804` |
  | Base Sepolia | `0x8d4B57eD464df10414Dde3ADC2E403a01ebc50d8` |
  | Avalanche Fuji | `0x64D160b7E91e78e52dFc0e8829640E32A919164C` |

  ### GasRelayer (deployed 2025-05-29)

  Enables gasless bridging. The user burns with `mintRecipient = GasRelayer`, the server calls `relay()`, and the contract mints USDC to itself then forwards `(amount − relayFee)` to the user wallet.

  | Chain | Address |
  |---|---|
  | Arc Testnet | `0x837D9a19C07bb7B4E95071dC0BaED72D4dE04ea1` |
  | Ethereum Sepolia | `0x5E87F210043D8457caCAd0F0c9aB70a99497Eec9` |
  | Base Sepolia | `0x64D160b7E91e78e52dFc0e8829640E32A919164C` |
  | Avalanche Fuji | `0x6F80056564491425273A6a481EcC5DAea9D57f23` |

  **Fee recipient (all contracts):** `0xdb5019b8DfbccEF8906C39B16a4870082eAbBc4C`

  ---

  ## Architecture

  ```
  User wallet (source chain)
    │
    ├─ 1. Approve TokenMessenger for bridgeAmount
    ├─ 2. Transfer 0.3% fee → FeeRouter (source chain)
    └─ 3. depositForBurn(amount, destDomain, mintRecipient, ...)
                │
                │  Circle CCTP V2
                ▼
          MessageTransmitter (destination chain)

  Standard path:
    └─ 4a. User switches wallet to destination chain
           receiveMessage(message, attestation)
           → USDC minted directly to user wallet

  Gasless relay path:
    └─ 4b. POST /api/relay  ←  server submits GasRelayer.relay()
           → USDC minted to GasRelayer contract
           → GasRelayer transfers (amount − 1 USDC) to user
           → GasRelayer transfers 1 USDC to feeRecipient
           → user never needs destination-chain gas
  ```

  ### Key design decisions

  - **Frontend-only bridge logic** — all CCTP calls run client-side via ethers.js + MetaMask; no custodial server
  - **CCTP V2 7-param `depositForBurn`** — selector `0x8e0250ee`; the V1 4-param variant will revert on these contracts
  - **Arc USDC is 6 decimals** via ERC-20 interface (native 18-decimal representation is gas-only)
  - **Per-chain `minFinalityThreshold`**: Arc = 2000 (finalized), all others = 1000 (safe, ~1-2 min attestation)
  - **GasRelayer `maxFee` guard** — frontend passes 2× expected fee so sudden bumps never silently over-charge
  - **Circle Iris sandbox API** for attestation polling; polls every 5 s up to 20 min

  ---

  ## Revenue

  Each transfer generates two fee streams (both to `feeRecipient`):

  | Fee | Where deducted | Amount |
  |---|---|---|
  | Protocol fee | Source chain (ERC-20 transfer before burn) | 0.3% of bridged amount |
  | Relay fee | Destination chain (inside GasRelayer) | 1 USDC flat (gasless only) |

  ---

  ## Stack

  | Layer | Technology |
  |---|---|
  | Frontend | React 19 + Vite + Tailwind CSS + shadcn/ui |
  | Web3 client | ethers.js v6 (BrowserProvider) |
  | Bridge protocol | Circle CCTP V2 |
  | Attestation | Circle Iris API (sandbox) |
  | API server | Express 5 + Node 24 + TypeScript |
  | Monorepo | pnpm workspaces |
  | Smart contracts | Solidity 0.8.20 (solc) |

  ---

  ## Project Structure

  ```
  artifacts/
    arc-bridge/          # React + Vite frontend
      src/lib/
        chains.ts        # Chain configs, CCTP domains, contract addresses, ABIs
        bridge.ts        # Full CCTP bridge flow + gasless relay path
        config.ts        # Fee configuration (FEE_BPS, FEE_RECIPIENT)
      src/pages/
        BridgePage.tsx   # Main bridge UI
      src/components/
        ChainSelector    # Chain picker
        StepProgress     # 5-step progress bar (Approve→Fee→Burn→Attest→Mint/Relay)
        WalletButton     # MetaMask connect/display
        TxLink           # Explorer link per chain

    api-server/          # Express API
      src/routes/
        attest.ts        # GET /api/attest — proxy to Circle Iris attestation
        relay.ts         # POST /api/relay — submit GasRelayer.relay() on-chain

  contracts/
    GasRelayer.sol       # Gasless relay paymaster contract
    FeeRouter.sol        # Protocol fee collection contract

  scripts/
    src/deploy.ts        # Deploy FeeRouter + GasRelayer to all chains
  ```

  ---

  ## Local Development

  ```bash
  # Install dependencies
  pnpm install

  # Run the frontend (reads PORT env)
  pnpm --filter @workspace/arc-bridge run dev

  # Run the API server
  pnpm --filter @workspace/api-server run dev

  # Typecheck everything
  pnpm run typecheck

  # Re-deploy contracts
  pnpm --filter @workspace/scripts run deploy
  ```

  ### Required environment secrets

  | Secret | Description |
  |---|---|
  | `DEPLOYER_PRIVATE_KEY` | Wallet that owns and funds the GasRelayer contracts |
  | `FEE_RECIPIENT` | Address that receives protocol fees (used at deploy time) |
  | `VITE_FEE_RECIPIENT` | Same address exposed to the frontend for fee display |
  | `SESSION_SECRET` | Express session signing key |

  ---

  ## Useful Links

  - [Circle Faucet](https://faucet.circle.com) — get testnet USDC
  - [Arc Docs](https://docs.arc.io) — Arc Testnet documentation
  - [CCTP Docs](https://developers.circle.com/stablecoins/cctp-getting-started)
  - [Arc Testnet Explorer](https://testnet.arcscan.app)
  - [Sepolia Etherscan](https://sepolia.etherscan.io)
  - [Base Sepolia Explorer](https://sepolia.basescan.org)
  - [Fuji Snowtrace](https://testnet.snowtrace.io)

  ---

  ## Gotchas

  - **All chains use CCTP V2** — always the 7-param `depositForBurn` (selector `0x8e0250ee`). The V1 4-param variant (`0x6fd3504e`) will `require(false)` on these contracts.
  - Arc Testnet USDC is at a special system address `0x3600…0000` — same ERC-20 interface, just an unusual address
  - Arc native tokens use 18 decimals for gas but ERC-20 USDC uses 6 — always go through the ERC-20 interface
  - Sepolia RPC: use `https://ethereum-sepolia-rpc.publicnode.com` — `rpc.sepolia.org` is unreliable
  - Arc Testnet explorer: `https://testnet.arcscan.app` — older URLs (`explorer.testnet.arc.network`, `explorer.arc.io`) are dead
  