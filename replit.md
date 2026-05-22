# Arc Relay Bridge

A cross-chain USDC relay bridge built on Circle's CCTP V2, deployable to ARC Testnet. Burn USDC on a source chain and natively mint it on the destination — no wrapped tokens, no liquidity pools.

## Run & Operate

- `pnpm --filter @workspace/arc-bridge run dev` — run the bridge frontend (reads `PORT` env)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React 19 + Vite + Tailwind CSS (shadcn/ui components)
- Web3: ethers.js v6 (BrowserProvider + Contract)
- Bridge Protocol: Circle CCTP V2
- Attestation: Circle Iris API (sandbox)

## Where things live

- `artifacts/arc-bridge/` — the bridge frontend app
- `artifacts/arc-bridge/src/lib/chains.ts` — all chain configs, CCTP domains, contract addresses, ABIs
- `artifacts/arc-bridge/src/lib/bridge.ts` — full CCTP bridge flow (approve → burn → attest → mint)
- `artifacts/arc-bridge/src/pages/BridgePage.tsx` — main bridge UI
- `artifacts/arc-bridge/src/components/` — ChainSelector, StepProgress, TxLink, WalletButton

## Architecture decisions

- Frontend-only: no backend needed — all bridge logic runs client-side via ethers.js + MetaMask
- CCTP V2 burn-and-mint: no liquidity pools, no wrapped tokens, 1:1 native USDC on both ends
- Circle Iris sandbox API for attestation polling (testnet-only endpoint)
- Chain switching is automatic mid-bridge (source → destination via `wallet_addEthereumChain`)
- USDC uses 6 decimals via ERC-20 interface (Arc's native 18-decimal representation is for gas only)

## Product

Users connect MetaMask, choose source/destination chains, enter a USDC amount, and execute a 4-step bridge (Approve → Burn → Attest → Mint). The UI shows real-time step progress and links to each transaction in the block explorer. Supports Arc Testnet ↔ Ethereum Sepolia, Base Sepolia, and Avalanche Fuji.

## Supported Chains (Testnet)

| Chain | CCTP Domain | Chain ID |
|---|---|---|
| Arc Testnet | 7 | 5042002 |
| Ethereum Sepolia | 0 | 11155111 |
| Base Sepolia | 6 | 84532 |
| Avalanche Fuji | 1 | 43113 |

## Gotchas

- Arc Testnet USDC: `0x3600000000000000000000000000000000000000` (special system address)
- Arc native USDC uses 18 decimals for gas, but the ERC-20 interface uses 6 decimals — always use ERC-20 interface
- Attestation can take 1–3 minutes on testnet; the UI polls every 5 seconds for up to 10 minutes
- Always verify contract addresses against https://docs.arc.io/arc/references/contract-addresses

## Key Links

- Arc Testnet Explorer: https://explorer.testnet.arc.network
- Circle Faucet (get testnet USDC): https://faucet.circle.com
- Arc Docs: https://docs.arc.io
- CCTP Docs: https://developers.circle.com/stablecoins/cctp-getting-started

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._
