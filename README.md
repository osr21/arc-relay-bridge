# Arc Relay Bridge

A cross-chain USDC bridge built on [Circle's CCTP V2](https://developers.circle.com/stablecoins/cctp-getting-started). Burn native USDC on one chain, mint it natively on another — no wrapped tokens, no liquidity pools.

**Supported routes (all bidirectional):**
- Arc Testnet ↔ Ethereum Sepolia
- Arc Testnet ↔ Base Sepolia
- Arc Testnet ↔ Avalanche Fuji
- Ethereum Sepolia ↔ Base Sepolia ↔ Avalanche Fuji

## Quick start

```bash
pnpm install
pnpm --filter @workspace/arc-bridge run dev      # Bridge UI
pnpm --filter @workspace/api-server run dev       # Attestation proxy
```

Get testnet USDC at [faucet.circle.com](https://faucet.circle.com).

## How it works

1. **Approve** — USDC spending approved to the CCTP TokenMessenger
2. **Fee** — 0.3% protocol fee transferred on the source chain
3. **Burn** — `depositForBurn()` destroys USDC and emits a cross-chain message
4. **Attest** — Circle's Iris API signs an attestation after block finality (~1–5 min)
5. **Mint** — `receiveMessage()` mints native USDC on the destination chain

The bridge is non-custodial — funds are never held by any intermediary.

## Stack

- **Frontend:** React 19 + Vite + Tailwind CSS
- **Web3:** ethers.js v6 (MetaMask / EIP-1193)
- **Protocol:** Circle CCTP V2 (all chains use the same contract addresses)
- **Backend:** Express.js attestation proxy (CORS bypass for Circle's Iris API)
- **Monorepo:** pnpm workspaces, TypeScript 5.9, Node.js 24

## Contract addresses

All chains: TokenMessenger `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA` · MessageTransmitter `0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275`

## Documentation

- [Overview & architecture](docs/overview.md)
- [User guide](docs/user-guide.md)
- [Technical reference](docs/technical-reference.md)
- [Development guide](docs/development.md)

## Links

- [Arc Docs](https://docs.arc.io)
- [CCTP Docs](https://developers.circle.com/stablecoins/cctp-getting-started)
- [Circle Faucet](https://faucet.circle.com)
