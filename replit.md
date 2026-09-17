# Arc Relay Bridge

A cross-chain USDC relay bridge built on Circle's CCTP V2, deployable to ARC Testnet. Burn USDC on a source chain and natively mint it on the destination — no wrapped tokens, no liquidity pools.

## Mainnet preparation — not launched

- Release scope: Arc Mainnet (5042) ↔ Base Mainnet (8453), with bridge, relay,
  gasless and refuel. **Yield must remain disabled until a real strategy is selected.**
- The frontend defaults to mainnet preparation, and the API defaults to the same
  environment. Mainnet payment capabilities remain locked while deployment,
  integration review and funding are incomplete; this is not a live bridge.
- Explicit testnet operation uses `VITE_NETWORK_ENV=testnet` for the frontend build
  and `ARC_NETWORK_ENV=testnet` for the API. Never mix these environments.
- Public network parameters and launch capabilities live in the SDK mainnet
  module. The addresses below are **testnet deployments only**; do not copy them
  into a mainnet manifest or run the legacy `deploy-all` script for mainnet.
- Mainnet relay requires the separate `GasRelayerV2` authenticated-hook protocol.
  Existing testnet burns and deployed legacy contracts are not migrated.
- Read `docs/mainnet-preflight.md` and `docs/relay-mainnet-protocol.md` before
  continuing launch work. Preflight is read-only, does not access a key, and does
  not authorize deployment or prove contract safety.

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
| Ethereum Sepolia | 0 | 11155111 | 0 (fast — testnet only) |
| Base Sepolia | 6 | 84532 | 0 (fast — testnet only) |
| Avalanche Fuji | 1 | 43113 | 0 (fast — testnet only) |

## Contract Addresses (same on all chains)

- TokenMessenger (CCTP V2): `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA`
- MessageTransmitter (CCTP V2): `0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275`
- Arc Testnet USDC: `0x3600000000000000000000000000000000000000`
- Sepolia USDC: `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`
- Base Sepolia USDC: `0x036CbD53842c5426634e7929541eC2318f3dCF7e`
- Fuji USDC: `0x5425890298aed601595a70AB815c96711a31Bc65`

## Paymaster Addresses (deployed 2026-06-16 v6-hardened, evmVersion paris, ERC-4337 v0.7)

v4 fix: removed `nonReentrant` from `validatePaymasterUserOp` — ERC-7562 forbids global storage writes (_locked bool) for unstaked paymasters; Pimlico rejects such UserOps at simulation. `onlyEntryPoint` is sufficient protection (EntryPoint never re-enters validation).
v5 fix: `deductGas` now checks available (unlocked) balance only — prevents double-charging a user when a pending UserOp has reserved funds concurrently.
v6 fix (audit): constructor now enforces `gasRate <= MAX_GAS_RATE` — previously the cap was only on `setGasRate()`.
entryPoint is a `constant` (not immutable) — keeps single-immutable init pattern (`0x60a0`) for chain compatibility.

| Chain | Address |
|---|---|
| Arc Testnet | `0xEE39e1690F1bE07e8a68813f57cE3142197CECf6` |
| Ethereum Sepolia | `0xe7ED22eF9Af9CAd98B048979dbd726e89dd0D417` |
| Base Sepolia | `0x5f309aE9A9A364Ae18af77b7733bB9C43A032A4A` |
| Avalanche Fuji | `0x0D3B7bd972F4Cc3CDAB62E1cFafcA79F8d7167f5` |

Re-deploy: `pnpm --filter @workspace/scripts run deploy-all`
Constructor: `(address usdc, address relayer, address feeRecipient, uint256 gasRate)` — 4 params; entryPoint is hardcoded constant.
Note: must compile with `evmVersion: "paris"` — Arc Testnet and Fuji reject PUSH0 (shanghai).
Note: 2-immutable init pattern (`0x60c0`) silently reverts on Arc/Base/Fuji — always keep entryPoint as `constant`, not `immutable`.
Note: validatePaymasterUserOp must NOT use nonReentrant — _locked is global storage, violates ERC-7562 for unstaked paymasters.

## GasRelayer Addresses (deployed 2026-06-16 v2-hardened)

v2 fix (audit): `rescueTokens` now blocks USDC — prevents owner from draining relay float.

| Chain | Address |
|---|---|
| Arc Testnet | `0xf89773D7d9C43c01203793bf991e2550975a0C49` |
| Ethereum Sepolia | `0x5eA2A91629245074D01EFf64fc223233c2a805E6` |
| Base Sepolia | `0x5bE70628f49aFb90D81d169bff1533F437B967BB` |
| Avalanche Fuji | `0x53183000a7Ae24AE9F1126271a66Eff1161a58Ec` |

Re-deploy: `pnpm --filter @workspace/scripts run deploy-all`

## FeeRouter Addresses (deployed 2026-06-16 v3-hardened)

v2 hardening: immutable usdc/tokenMessenger (no caller-supplied addresses), reentrancy lock, zero mintRecipient check, rescueTokens return-value check.
v3 fix (audit): two-step ownership — `transferOwnership` now sets `pendingOwner`; new `acceptOwnership()` completes the transfer. Prevents accidental permanent ownership loss.

| Chain | Address |
|---|---|
| Arc Testnet | `0x0812a44BDB8975d1Fa1DA93726385Bc4dDC31C6A` |
| Ethereum Sepolia | `0x9d54E104680D2C80FE117e1A66862f619F0a4cBa` |
| Base Sepolia | `0x245aB059961D5D4A29D2fDf6AefA75b029Ed445d` |
| Avalanche Fuji | `0xce4794207CFCCDC06B283b6942f5BB44a32F5398` |

Fee recipient: `0xdb5019b8DfbccEF8906C39B16a4870082eAbBc4C`
Re-deploy: `pnpm --filter @workspace/scripts run deploy-all`

## YieldVault Addresses (deployed 2026-06-16 v2-hardened)

v2 fix (audit): reentrancy guard on deposit/withdraw, `rescueTokens` blocks USDC, two-step ownership, zero-address guard on `transferOwnership`, `withdraw` event now emits correct (pre-delete) principal.

| Chain | Address | APY |
|---|---|---|
| Arc Testnet | `0xFf8f0Fc1Cca51ddE49ee1E7083D36CC99Af01665` | 18.5% |
| Ethereum Sepolia | `0xd4a11E7C3512A5c9C09E0296bB06490244476673` | 7.8% |
| Base Sepolia | `0x0D3B7bd972F4Cc3CDAB62E1cFafcA79F8d7167f5` | 12.3% |
| Avalanche Fuji | `0xEE39e1690F1bE07e8a68813f57cE3142197CECf6` | 9.2% |

Re-deploy: `pnpm --filter @workspace/scripts run deploy-all`

## Gotchas

- **ALL chains use CCTP V2** — the 7-param `depositForBurn` (selector `0x8e0250ee`). The V1 4-param selector (`0x6fd3504e`) will `require(false)` on these contracts.
- Arc Testnet USDC: `0x3600000000000000000000000000000000000000` (special system address)
- Arc native USDC uses 18 decimals for gas, but the ERC-20 interface uses 6 decimals — always use ERC-20 interface
- Arc Testnet explorer: `https://testnet.arcscan.app` (use `/tx/{hash}` for transactions). Previous explorer URLs (`explorer.testnet.arc.network`, `explorer.arc.io`) are dead.
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
