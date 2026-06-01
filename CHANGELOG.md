# Changelog

  All notable changes to Arc Relay Bridge are documented here.

  ---

  ## [Paymaster v3] — 2026-06-01

  ### Added

  - **ERC-4337 v0.7 gas sponsorship** — The Paymaster contract now implements the full ERC-4337 v0.7 interface accepted by the canonical EntryPoint (`0x0000000071727De22E5E9d8BAf0edAc6f37da032`):
    - `validatePaymasterUserOp` — validates a UserOperation and reserves the maximum possible USDC cost in a `locked` mapping so the user's available balance is accurately accounted for during bundler simulation
    - `postOp` — called by the EntryPoint after execution; releases the reservation and charges the actual gas cost in USDC
  - **Locked-balance reservation system** — `mapping(address => uint256) public locked` tracks how much of each user's deposit is reserved for in-flight UserOperations, preventing double-spending across concurrent ops
  - **Reentrancy guard** — a `bool private _locked` mutex + `nonReentrant` modifier on all state-modifying user functions (`deposit`, `withdraw`, `validatePaymasterUserOp`, `postOp`, `deductGas`)

  ### Changed

  - **`entryPoint` is now a `constant`** (previously planned as `immutable`). The ERC-4337 v0.7 EntryPoint is deployed via CREATE2 and resolves to the same address on every EVM chain, so hardcoding it as a constant is both correct and avoids a chain-compatibility issue: contracts with two or more `immutable` variables generate a `0x60c0` constructor prefix that silently reverts on Arc Testnet, Base Sepolia, and Avalanche Fuji. The single-immutable `0x60a0` pattern (only `usdc` is immutable) is required for cross-chain compatibility.
  - **Constructor reduced to 4 parameters** — `_entryPoint` parameter removed; `entryPoint` is now a compile-time constant. Constructor signature: `(address usdc, address relayer, address feeRecipient, uint256 gasRate)`
  - **Deploy script: `--only` flag** — deploy to a subset of chains without redeploying the rest: `pnpm --filter @workspace/scripts run deploy-paymaster -- --only sepolia` or `--only arc,fuji`
  - **Deploy script: per-chain gas limits** — Arc Testnet, Base Sepolia, and Avalanche Fuji use an explicit `gasLimit: 3_000_000` override (because their RPCs reject `eth_estimateGas` on failed constructors). Ethereum Sepolia uses auto-estimation to avoid pre-flight balance failures

  ### Deployed addresses (v3)

  | Chain | Address |
  |---|---|
  | Arc Testnet | [`0x3fAC0e0F8d8BfE9498d06332582C48Dc32698D65`](https://testnet.arcscan.app/address/0x3fAC0e0F8d8BfE9498d06332582C48Dc32698D65) |
  | Ethereum Sepolia | [`0xfF57188ea392bA5e91bdf675AAA55f2D8Ba9BdBe`](https://sepolia.etherscan.io/address/0xfF57188ea392bA5e91bdf675AAA55f2D8Ba9BdBe) |
  | Base Sepolia | [`0x3649C856025FDC0F92EDAc2B52DD53452248bA33`](https://sepolia.basescan.org/address/0x3649C856025FDC0F92EDAc2B52DD53452248bA33) |
  | Avalanche Fuji | [`0xd9E34Aca62a16a58a4e7144130Be94bD908D368c`](https://testnet.snowtrace.io/address/0xd9E34Aca62a16a58a4e7144130Be94bD908D368c) |

  ---

  ## [Paymaster v2] — 2025-05-31

  ### Added

  - **Paymaster contract** — USDC-based gas sponsorship deployed on all four supported chains. Users pre-deposit USDC; a trusted relayer calls `deductGas` to charge actual gas costs after each sponsored transaction.
  - **`rescueTokens` USDC block** — `rescueTokens` explicitly rejects rescue of the USDC token address, protecting user deposits from accidental or malicious withdrawal by the owner.
  - **`setGasRate` cap** — `setGasRate` is capped at `MAX_GAS_RATE` (1 USDC per gas unit, i.e. 1,000,000 in 6-decimal units) to protect users from an owner setting an extreme rate.
  - **Two-step ownership transfer** — `transferOwnership` + `acceptOwnership` pattern; the new owner must explicitly accept to prevent accidental transfers to wrong addresses.
  - **Emergency pause** — owner can call `pause()` / `unpause()` to freeze deposits, withdrawals, and sponsorships.

  ---

  ## [FeeRouter v2] — 2025-05-23

  ### Added

  - **FeeRouter contract** — On-chain fee routing that collects a protocol fee before calling CCTP `depositForBurn`. Deployed on all four chains.

  ### Security hardening over v1

  - `usdc` and `tokenMessenger` are immutable — no caller-supplied contract addresses eliminates address substitution attacks
  - Reentrancy lock on `bridgeWithFee`
  - Zero `mintRecipient` check — reverts if recipient is `bytes32(0)`
  - `rescueTokens` checks IERC20 return value

  ### Deployed addresses

  | Chain | Address |
  |---|---|
  | Arc Testnet | `0x8256a1e1f8971448b49dA0F55b8A1BB6557eA8FC` |
  | Ethereum Sepolia | `0x5B1F511ed4dF76f369671BF1c4aCF0dD84CC0804` |
  | Base Sepolia | `0x8d4B57eD464df10414Dde3ADC2E403a01ebc50d8` |
  | Avalanche Fuji | `0x64D160b7E91e78e52dFc0e8829640E32A919164C` |
  