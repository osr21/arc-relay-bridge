# Development Guide

## Project structure

```
artifacts/
  arc-bridge/          # Bridge frontend (React + Vite)
    src/
      components/      # UI components
        ChainSelector.tsx   # Chain dropdown with logo + domain
        StepProgress.tsx    # 5-step visual progress bar
        TxLink.tsx          # Explorer link or copy-to-clipboard for tx hashes
        WalletButton.tsx    # Connect/disconnect wallet display
      contracts/
        FeeRouterABI.ts     # ABI for optional on-chain FeeRouter (not deployed)
      lib/
        bridge.ts       # All bridge logic — approve, burn, attest, mint
        chains.ts       # Chain configs, contract addresses, ABIs
        config.ts       # Fee configuration (FEE_BPS, calculateFee)
      pages/
        BridgePage.tsx  # Main bridge UI
  api-server/          # Express API server — attestation proxy
    src/
      routes/
        attest.ts       # GET /api/attest and /api/attest/hash/:messageHash
```

## Running locally

```bash
# Install dependencies
pnpm install

# Start the bridge frontend
pnpm --filter @workspace/arc-bridge run dev

# Start the API server (attestation proxy)
pnpm --filter @workspace/api-server run dev

# Type-check everything
pnpm run typecheck
```

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `VITE_FEE_RECIPIENT` | Optional | Wallet address to receive protocol fees. Leave empty to disable fee collection. |
| `SESSION_SECRET` | Optional | Used by the API server for session management. |
| `PORT` | Auto-set | Port for each service (injected by Replit workflows). |

Set secrets via Replit's Secrets panel — never commit them to the repo.

## Adding a new chain

1. Open `artifacts/arc-bridge/src/lib/chains.ts`
2. Add a new entry to the `CHAINS` object:

```typescript
NEW_CHAIN: {
  id: 12345,
  hexId: "0x3039",
  name: "My Chain Testnet",
  shortName: "MyChain",
  rpcUrl: "https://rpc.mychain.example",
  explorerUrl: "https://explorer.mychain.example",
  cctpDomain: 99,           // From Circle's CCTP domain registry
  usdcAddress: "0x...",     // USDC contract on this chain
  tokenMessenger: "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA",
  messageTransmitter: "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  cctpVersion: 2,
  minFinalityThreshold: 1000,
  logoColor: "#AABBCC",
},
```

3. Run `pnpm run typecheck` to verify there are no errors.

> **Important:** Verify that the TokenMessenger and MessageTransmitter addresses are correct for the new chain. On-chain probe `localDomain()` (selector `0x8d3638f4`) to confirm the MessageTransmitter is a live CCTP contract.

## Key design decisions

### Why frontend-only?

The bridge logic runs entirely in the browser via ethers.js + MetaMask. No backend is needed for the actual bridging — only the attestation proxy server exists to avoid CORS restrictions when calling Circle's Iris API.

### Why CCTP V2 on all chains?

All supported chains (Arc, Sepolia, Base Sepolia, Fuji) use the same CCTP V2 TokenMessenger contract at address `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA`. The older V1 4-parameter `depositForBurn` selector (`0x6fd3504e`) is not supported by these contracts — always use the 7-parameter V2 version (selector `0x8e0250ee`).

### Why manual fee collection?

A FeeRouter smart contract ABI exists in the codebase but no FeeRouter is deployed. Instead, fees are collected via a plain ERC-20 `transfer()` on the source chain before the burn. This requires no contract deployment and works on any EVM chain.

### Why dual attestation polling?

The bridge tries two Circle Iris API paths every polling round:

1. `/v1/attestations/{messageHash}` — content-addressed, works as soon as the attestation is signed
2. `/v2/messages/{domain}?transactionHash={hash}` — returns `pending_confirmations` status which is useful for showing progress

This maximises reliability: if one endpoint is slow, the other may respond first.

## Common pitfalls

- **Calling V1 ABI on V2 contracts** — always check `cctpVersion` in the chain config before choosing which ABI to use.
- **Wrong selector for USDC decimals** — Arc's USDC is at a system address and uses 6 decimals via the ERC-20 interface even though the native gas token uses 18 decimals.
- **RPC reliability** — public RPC endpoints go down. `rpc.sepolia.org` is known to be unreliable; use `ethereum-sepolia-rpc.publicnode.com` instead.
- **Arc explorer** — `explorer.testnet.arc.network` is frequently unavailable. TxLink renders a copy-to-clipboard button for Arc transactions instead of a dead link.
