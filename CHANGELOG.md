# Changelog

  All notable changes to Arc Relay Bridge are documented here.

  ---

  ## [2026-06-03] — ERC-4337 Debugging & UI Fixes

  ### Fixed

  - **Stale Paymaster addresses in API server** — `artifacts/api-server/src/routes/paymaster.ts` contained v3/v4 addresses. Updated to v5 on all four chains. Stale addresses caused the gasless relay path to silently reject UserOps against the wrong contract.

  - **EntryPoint had 0 ETH deposited** — All v5 Paymaster contracts had no ETH at the ERC-4337 EntryPoint (`0x0000000071727De22E5E9d8BAf0edAc6f37da032`). Pimlico's bundler simulation rejected every UserOp with `AA31 paymaster deposit too low`. Fixed by running the new `fund-paymaster` script:
    - Ethereum Sepolia: 0.05 ETH
    - Base Sepolia: 0.02 ETH
    - Avalanche Fuji: 0.05 ETH

  - **Bridge page showed EOA balance in gasless mode** — The FROM section displayed the MetaMask EOA's USDC balance when ERC-4337 gasless mode was enabled. But USDC for the burn comes from the *smart account's own wallet*, not the EOA. Entering an amount larger than the smart account wallet held caused a cryptic error with no balance visible to compare against. Fixed:
    - FROM section now shows **"Smart account wallet: X USDC"** when gasless is active
    - MAX button caps to smart account wallet balance
    - Insufficient-balance warning explicitly states the smart account balance
    - Gasless info banner shows the smart account wallet USDC with a clear distinction from the Paymaster gas vault

  - **Gasless info banner conflated two USDC pools** — The banner said "Your smart account pays gas via its USDC balance in the Paymaster" which confused the Paymaster gas vault (gas fees, ~0.5–2 USDC per bridge) with the smart account wallet balance (bridge burn amount). Both pools are now shown with clear separate labels.

  ### Reverted

  - **EOA approve / transferFrom approach** — An attempt to pull USDC from the MetaMask EOA directly (via a one-time `approve(smartAccount, MaxUint256)` + `transferFrom` in the UserOp) was reverted. The EOA approval itself requires native gas (ETH on Sepolia, AVAX on Fuji), breaking the zero-native-tokens guarantee. Correct model: smart account wallet holds USDC for burns; Paymaster gas vault covers bundler fees.

  ### Added

  - **`scripts/src/fundPaymaster.ts`** — Script to top up EntryPoint ETH deposits for all Paymasters. Supports `--only <chain>` and `--amount <eth>` flags:
    ```bash
    pnpm --filter @workspace/scripts run fund-paymaster
    pnpm --filter @workspace/scripts run fund-paymaster -- --only sepolia --amount 0.05
    ```
  - **`deployPaymaster.ts` auto-funds EntryPoint** — After deploying a Paymaster the script now deposits 0.05 ETH at the EntryPoint automatically.

  ---

  ## [Paymaster v5] — 2026-06-01

  ### Fixed (vs v4)

  - **`deductGas` double-charge on concurrent UserOps** — Checked `balances[user]` without accounting for locked funds. Fixed: checks `available = balances[user] - locked[user]`.

  ### Architecture (carried from v4)

  - `validatePaymasterUserOp` has no `nonReentrant` — ERC-7562 forbids global storage writes during validation for unstaked paymasters.
  - `entryPoint` is a `constant` — keeps single-slot `0x60a0` init; 2-immutable `0x60c0` silently reverts on Arc/Base/Fuji.
  - Compiled with `evmVersion: "paris"` — Arc Testnet and Fuji reject `PUSH0` (Shanghai).

  ---

  ## [Paymaster v4] — 2026-06-01

  ### Fixed (vs v3)

  - **`nonReentrant` on `validatePaymasterUserOp`** — Removed. Writing to `_locked` (global storage) during validation violates ERC-7562; Pimlico rejects at simulation.

  ---

  ## [Paymaster v3] — 2026-06-01

  ### Added

  - ERC-4337 v0.7 path: `validatePaymasterUserOp` + `postOp`
  - Dual sponsorship: legacy relayer (`deductGas`) + ERC-4337 path
  - `locked[user]` reservation prevents double-spend across concurrent UserOps
  - `MAX_DEDUCTION_PER_TX = 10 USDC` hard cap per call
  - Emergency pause, two-step ownership, `rescueTokens` (USDC blocked)

  ---

  ## [FeeRouter v2] — 2026-05-23

  ### Fixed (vs v1)

  - Immutable `usdc` and `tokenMessenger` (no caller-supplied addresses)
  - Reentrancy lock on all state-changing functions
  - Zero `mintRecipient` guard
  - `rescueTokens` checks return value; blocks USDC rescue
  