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
  - **Public REST API** — any dApp can use the relay, attestation proxy, and chain discovery endpoints
  - **TypeScript SDK** — drop-in library for integrating the relay into your own dApp

  ---

  ## Supported Chains (Testnet)

  | Chain | CCTP Domain | Chain ID | Min Finality |
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

  ### FeeRouter v2

  | Chain | Address |
  |---|---|
  | Arc Testnet | `0x8256a1e1f8971448b49dA0F55b8A1BB6557eA8FC` |
  | Ethereum Sepolia | `0x5B1F511ed4dF76f369671BF1c4aCF0dD84CC0804` |
  | Base Sepolia | `0x8d4B57eD464df10414Dde3ADC2E403a01ebc50d8` |
  | Avalanche Fuji | `0x64D160b7E91e78e52dFc0e8829640E32A919164C` |

  ### GasRelayer (gasless paymaster)

  | Chain | Address |
  |---|---|
  | Arc Testnet | `0x837D9a19C07bb7B4E95071dC0BaED72D4dE04ea1` |
  | Ethereum Sepolia | `0x5E87F210043D8457caCAd0F0c9aB70a99497Eec9` |
  | Base Sepolia | `0x64D160b7E91e78e52dFc0e8829640E32A919164C` |
  | Avalanche Fuji | `0x6F80056564491425273A6a481EcC5DAea9D57f23` |

  **Fee recipient (all contracts):** `0xdb5019b8DfbccEF8906C39B16a4870082eAbBc4C`

  ---

  ## REST API

  Base URL: `https://arc-relay-bridge.replit.app`

  All endpoints return JSON. CORS is open — any origin may call them.

  ### GET /api/chains

  Returns all supported chains with live relay fees read from the on-chain GasRelayer contracts.

  ```bash
  curl https://arc-relay-bridge.replit.app/api/chains
  ```

  ```json
  {
    "chains": [
      {
        "id": 5042002,
        "name": "Arc Testnet",
        "shortName": "Arc",
        "cctpDomain": 26,
        "usdcAddress": "0x3600000000000000000000000000000000000000",
        "gasRelayerAddress": "0x837D9a19C07bb7B4E95071dC0BaED72D4dE04ea1",
        "explorerUrl": "https://testnet.arcscan.app",
        "relayFeeUnits": "1000000"
      }
    ]
  }
  ```

  ---

  ### GET /api/relay/fee?chainId=\<chainId\>

  Returns the current relay fee for a single destination chain (live, from the contract).

  ```bash
  curl "https://arc-relay-bridge.replit.app/api/relay/fee?chainId=5042002"
  # → { "chainId": 5042002, "relayFee": "1000000", "chain": "Arc Testnet" }
  ```

  ---

  ### POST /api/relay

  Submit a gasless CCTP relay. The server calls `GasRelayer.relay()` on-chain and returns the destination tx hash immediately.

  The caller must have already burned USDC with `mintRecipient` set to the GasRelayer contract address on the destination chain.

  **Request body:**

  | Field | Type | Description |
  |---|---|---|
  | `message` | string | 0x-hex CCTP message bytes from the source burn event |
  | `attestation` | string | 0x-hex Circle Iris attestation signature |
  | `recipient` | string | User wallet address on the destination chain |
  | `destChainId` | number | EVM chain ID of the destination chain |
  | `maxFee` | string | Maximum relay fee accepted (USDC units, 6 decimals) |

  ```bash
  curl -X POST https://arc-relay-bridge.replit.app/api/relay \
    -H "Content-Type: application/json" \
    -d '{
      "message":     "0x...",
      "attestation": "0x...",
      "recipient":   "0xYourWallet",
      "destChainId": 5042002,
      "maxFee":      "2000000"
    }'
  # → { "txHash": "0x...", "relayFee": "1000000", "chain": "Arc Testnet" }
  ```

  **Rate limits:** 20 req/min per IP for relay, 200/min for attestation, 60/min for chains.

  ---

  ### GET /api/attest?domain=\<domain\>&txHash=\<hash\>

  Proxy to Circle Iris attestation API. Avoids CORS issues from browser dApps.

  ```bash
  curl "https://arc-relay-bridge.replit.app/api/attest?domain=0&txHash=0x..."
  # → { "messages": [{ "attestation": "0x...", "message": "0x...", "status": "complete" }] }
  ```

  ---

  ## TypeScript SDK

  The `@workspace/arc-relay-sdk` package (in `lib/arc-relay-sdk/`) provides typed wrappers around all of the above. No ethers.js dependency — pure TypeScript and fetch.

  ```ts
  import {
    CHAINS,
    calculateFee,
    parseUsdc,
    formatUsdc,
    pollAttestation,
    callRelay,
    getRelayFee,
    getSupportedChains,
  } from "@workspace/arc-relay-sdk";

  // 1. Calculate fees
  const gross = parseUsdc("10");                            // → 10_000_000n
  const fee   = calculateFee(gross, true);                  // true = gasless relay
  console.log("You receive:", formatUsdc(fee.netAmount));   // "8.97" (0.3% + 1 USDC)

  // 2. Get live relay fee from chain
  const liveRelayFee = await getRelayFee(
    "https://arc-relay-bridge.replit.app",
    5042002   // Arc Testnet
  );

  // 3. Poll for attestation after a burn
  const attest = await pollAttestation(
    "https://arc-relay-bridge.replit.app",
    burnTxHash,
    0,          // source CCTP domain (0 = Sepolia)
    { onStatus: console.log }
  );

  // 4. Submit gasless relay
  const result = await callRelay("https://arc-relay-bridge.replit.app", {
    message:     attest.message,
    attestation: attest.attestation,
    recipient:   "0xYourWallet",
    destChainId: 5042002,
    maxFee:      (liveRelayFee * 2n).toString(),
  });
  console.log("Relay tx:", result.txHash);
  ```

  ### SDK exports

  | Export | Description |
  |---|---|
  | `CHAINS`, `ALL_CHAINS` | Chain config objects for all 4 chains |
  | `getChainById(id)` | Look up chain by EVM chain ID |
  | `getChainByCctpDomain(domain)` | Look up chain by CCTP domain |
  | `calculateFee(grossUnits, useRelay?)` | Full fee breakdown (protocolFee, relayFee, netAmount) |
  | `formatUsdc(units)` | bigint → "1.5" string |
  | `parseUsdc(str)` | "1.5" → 1_500_000n |
  | `GAS_RELAY_FEE_UNITS` | Current flat relay fee constant (1_000_000n) |
  | `pollAttestation(base, txHash, domain)` | Poll until Circle Iris attestation is ready |
  | `callRelay(base, params)` | Submit a gasless relay request |
  | `getRelayFee(base, chainId)` | Fetch live relay fee from contract |
  | `getSupportedChains(base)` | Fetch all chain configs + live fees |

  ---

  ## GasRelayer as a Shared Paymaster

  Any dApp on Arc Testnet can use the GasRelayer contracts as a paymaster for their CCTP burns — no contract deployment required.

  ### Integration steps

  1. **On the source chain**: call `TokenMessenger.depositForBurn` with:
     ```solidity
     mintRecipient = bytes32(uint256(uint160(gasRelayerAddress)));
     // e.g. Arc GasRelayer: 0x837D9a19C07bb7B4E95071dC0BaED72D4dE04ea1
     ```

  2. **After the burn confirms**: poll for the Circle Iris attestation.

  3. **Submit the relay**: POST to `/api/relay` with the message, attestation, your user's wallet as `recipient`, and a `maxFee`.

  4. **Result**: the GasRelayer calls `receiveMessage`, receives the minted USDC, deducts 1 USDC, and forwards the rest to your user — no gas required on the destination chain.

  ### Smart contract interface

  See `contracts/interfaces/IGasRelayer.sol` for the full interface, and `contracts/examples/ComposableReceiver.sol` for an example of a dApp contract that receives bridged USDC and deposits it into a vault atomically.

  ---

  ## On-Chain Composability

  For dApps that want to receive bridged USDC and run custom logic (swap, stake, deposit) in the same transaction:

  ```solidity
  // Your contract IS the CCTP mintRecipient.
  // Use ComposableReceiver.sol as a starting point.

  // Source chain: burn with mintRecipient = address(yourContract)
  TokenMessenger(cctp).depositForBurn(
    amount, destDomain,
    bytes32(uint256(uint160(address(yourContract)))),
    bytes32(0), 0, minFinalityThreshold
  );

  // Destination chain: relayer calls your contract after GasRelayer transfer
  yourContract.processIncoming(userAddress);
  // → deposits USDC into vault on behalf of user
  ```

  See `contracts/interfaces/` and `contracts/examples/` for full implementations.

  ---

  ## Architecture

  ```
  User wallet (source chain)
    │
    ├─ 1. Approve TokenMessenger
    ├─ 2. ERC-20 transfer 0.3% → FeeRouter
    └─ 3. depositForBurn(amount, destDomain, mintRecipient, ...)
                │
                │  Circle CCTP V2 + Iris attestation
                ▼
          MessageTransmitter (destination chain)

  Standard path:
    └─ 4a. User wallet calls receiveMessage → USDC minted directly

  Gasless relay path:
    └─ 4b. POST /api/relay
           → GasRelayer.relay()
           → receiveMessage (mints to GasRelayer)
           → transfer(feeRecipient, 1 USDC)
           → transfer(user wallet, net USDC)
           → user never needs destination-chain gas

  Composable path:
    └─ 4c. Your contract is the mintRecipient
           → USDC arrives at your contract
           → processIncoming() runs vault/swap/stake logic
  ```

  ---

  ## Revenue

  | Fee | Where | Amount |
  |---|---|---|
  | Protocol fee | Source chain, before burn | 0.30% of bridged amount |
  | Relay fee | Destination chain, inside GasRelayer | 1 USDC flat (gasless only) |

  Both go to: `0xdb5019b8DfbccEF8906C39B16a4870082eAbBc4C`

  ---

  ## Stack

  | Layer | Technology |
  |---|---|
  | Frontend | React 19 + Vite + Tailwind CSS + shadcn/ui |
  | Web3 client | ethers.js v6 (BrowserProvider) |
  | Bridge protocol | Circle CCTP V2 |
  | Attestation | Circle Iris API (sandbox) |
  | API server | Express 5 + Node 24 + TypeScript |
  | SDK | TypeScript, zero dependencies |
  | Monorepo | pnpm workspaces |
  | Smart contracts | Solidity 0.8.20 (solc) |

  ---

  ## Project Structure

  ```
  artifacts/
    arc-bridge/               # React + Vite bridge UI
      src/lib/
        chains.ts             # Chain configs, ABIs, contract addresses
        bridge.ts             # CCTP flow + gasless relay path
        config.ts             # Fee configuration
      src/pages/BridgePage.tsx
      src/components/         # ChainSelector, StepProgress, WalletButton, TxLink

    api-server/               # Express API server
      src/routes/
        attest.ts             # GET /api/attest — Circle Iris proxy
        relay.ts              # POST /api/relay, GET /api/relay/fee
        chains.ts             # GET /api/chains

  lib/
    arc-relay-sdk/            # TypeScript SDK (zero dependencies)
      src/
        types.ts              # Chain, FeeBreakdown, AttestationResult, RelayResult
        chains.ts             # CHAINS, getChainById, getChainByCctpDomain
        fees.ts               # calculateFee, formatUsdc, parseUsdc
        attest.ts             # pollAttestation
        relay.ts              # callRelay, getRelayFee, getSupportedChains
        index.ts              # re-exports everything

  contracts/
    GasRelayer.sol            # Gasless relay paymaster
    FeeRouter.sol             # Protocol fee collection
    FeeRouter_v2.sol
    interfaces/
      IGasRelayer.sol         # Interface for external integrations
      IFeeRouter.sol
    examples/
      ComposableReceiver.sol  # Example: receive USDC + run custom logic

  scripts/
    src/deploy.ts             # Deploy all contracts to all chains
  ```

  ---

  ## Local Development

  ```bash
  pnpm install

  # Frontend
  pnpm --filter @workspace/arc-bridge run dev

  # API server
  pnpm --filter @workspace/api-server run dev

  # Typecheck everything
  pnpm run typecheck

  # Redeploy contracts
  pnpm --filter @workspace/scripts run deploy
  ```

  ### Environment secrets

  | Secret | Description |
  |---|---|
  | `DEPLOYER_PRIVATE_KEY` | Owns and funds the GasRelayer contracts |
  | `FEE_RECIPIENT` | Fee recipient address (used at deploy time) |
  | `VITE_FEE_RECIPIENT` | Fee recipient exposed to the frontend |
  | `SESSION_SECRET` | Express session key |

  ---

  ## Gotchas

  - **CCTP V2 only** — always the 7-param `depositForBurn` (selector `0x8e0250ee`). V1 4-param will revert.
  - Arc USDC at `0x3600…0000` uses 6 decimals via ERC-20, not 18.
  - Sepolia RPC: use `https://ethereum-sepolia-rpc.publicnode.com` — `rpc.sepolia.org` is unreliable.
  - Arc Testnet explorer: `https://testnet.arcscan.app` — older URLs are dead.
  - `minFinalityThreshold`: Arc requires 2000 (finalized); all other chains use 1000 (safe).

  ---

  ## Links

  - [Circle Faucet](https://faucet.circle.com) — get testnet USDC
  - [Arc Docs](https://docs.arc.io)
  - [CCTP Docs](https://developers.circle.com/stablecoins/cctp-getting-started)
  - [Arc Testnet Explorer](https://testnet.arcscan.app)
  - [Sepolia Etherscan](https://sepolia.etherscan.io)
  - [Base Sepolia Explorer](https://sepolia.basescan.org)
  - [Fuji Snowtrace](https://testnet.snowtrace.io)
  