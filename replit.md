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
- Bridge Protocol: Circle CCTP V2 (all chains)
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
- Per-chain `minFinalityThreshold`: Arc=2000 (finalized), all others=1000 (safe, ~1-2 min attestation)

## Product

Users connect MetaMask, choose source/destination chains, enter a USDC amount, and execute a 4-step bridge (Approve → Burn → Attest → Mint). The UI shows real-time step progress and links to each transaction in the block explorer. Supports Arc Testnet ↔ Ethereum Sepolia, Base Sepolia, and Avalanche Fuji.

## Supported Chains (Testnet)

| Chain | CCTP Domain | Chain ID | minFinalityThreshold |
|---|---|---|---|
| Arc Testnet | 26 | 5042002 | 2000 (finalized) |
| Ethereum Sepolia | 0 | 11155111 | 1000 (safe) |
| Base Sepolia | 6 | 84532 | 1000 (safe) |
| Avalanche Fuji | 1 | 43113 | 1000 (safe) |

## Contract Addresses (same on all chains)

- TokenMessenger (CCTP V2): `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA`
- MessageTransmitter (CCTP V2): `0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275`
- Arc Testnet USDC: `0x3600000000000000000000000000000000000000`
- Sepolia USDC: `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`
- Base Sepolia USDC: `0x036CbD53842c5426634e7929541eC2318f3dCF7e`
- Fuji USDC: `0x5425890298aed601595a70AB815c96711a31Bc65`

## Gotchas

- **ALL chains use CCTP V2** — the 7-param `depositForBurn` (selector `0x8e0250ee`). The V1 4-param selector (`0x6fd3504e`) will `require(false)` on these contracts.
- Arc Testnet USDC: `0x3600000000000000000000000000000000000000` (special system address)
- Arc native USDC uses 18 decimals for gas, but the ERC-20 interface uses 6 decimals — always use ERC-20 interface
- Arc Testnet explorer (`explorer.testnet.arc.network`) is down; `explorer.arc.io` requires team login. TxLink shows copy-to-clipboard for Arc tx hashes instead of dead links.
- Sepolia RPC: use `https://ethereum-sepolia-rpc.publicnode.com` — `rpc.sepolia.org` is unreliable/down
- Attestation timing: Arc burns attest in ~1-3 min; Sepolia→Arc burns attest in ~2-5 min (safe finality). UI polls every 5s for up to 20 min.
- The V2 `depositForBurn` parameters: `destinationCaller=bytes32(0)` (anyone may relay), `maxFee=0`, `minFinalityThreshold` per chain.
- Always verify contract addresses against https://docs.arc.io/arc/references/contract-addresses

## Key Links

- Circle Faucet (get testnet USDC): https://faucet.circle.com
- Arc Docs: https://docs.arc.io
- CCTP Docs: https://developers.circle.com/stablecoins/cctp-getting-started
- Sepolia Etherscan: https://sepolia.etherscan.io
- Base Sepolia Explorer: https://sepolia.basescan.org
- Fuji Explorer: https://testnet.snowtrace.io

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._
