# Paymaster

  The Paymaster contract enables gasless bridging — users pay transaction fees in USDC instead of native tokens (ETH, AVAX).

  ## Contract addresses (v5)

  | Chain | Address |
  |---|---|
  | Arc Testnet | `0xfD06D288d481515a986DF28030AF013De290D76C` |
  | Ethereum Sepolia | `0xC9E9ba0bfE58FA438B8B6f2182d3ADA3669F9Eb4` |
  | Base Sepolia | `0xe355E9dCdEAB37eA8fd81b9457Ad2C56d3eE9055` |
  | Avalanche Fuji | `0x7C75A75B59b63871e1Bb47fA63e541F0e5975f93` |

  Re-deploy: `pnpm --filter @workspace/scripts run deploy-paymaster`

  ## Two distinct USDC pools

  | Pool | Purpose | Notes |
  |---|---|---|
  | **Smart account wallet** | USDC burned for the bridge | Whatever you want to bridge |
  | **Paymaster gas vault** | Bundler gas fees per bridge | Keep ≥ 1.8 USDC |

  The gas vault does **not** contribute to the bridge amount. A vault with 17 USDC does not let you bridge 17 USDC — the smart account wallet also needs USDC.

  ## ERC-4337 flow

  ```
  User signs UserOperation
          │
  EntryPoint v0.7 → validatePaymasterUserOp()
      • Checks available = balances[user] - locked[user] ≥ maxUsdcCost
      • Locks  locked[user] += maxUsdcCost
      • Returns context = abi.encode(user, maxUsdcCost)
          │
  EntryPoint executes inner calls
      • USDC.approve(tokenMessenger, burnAmount)
      • TokenMessenger.depositForBurn(...)
          │
  EntryPoint → postOp()
      • Unlocks locked[user] -= reserved
      • Calculates actualUsdcCost = (actualGasCost / feePerGas) × gasRate
      • Deducts  balances[user] -= actualUsdcCost
      • Transfers actualUsdcCost → feeRecipient
      • Emits GasSponsored(user, usdcDeducted, remainingBalance)
  ```

  ## One-time setup per chain

  1. **Fund the smart account wallet** — send USDC from MetaMask to the SimpleAccount address shown on the Paymaster page. Regular ERC-20 transfer, tiny native gas, done once.
  2. **Deposit USDC to gas vault** — Paymaster page → enter amount → Deposit. Pimlico-sponsored UserOp; no native gas needed.
  3. **Bridge** — enable ERC-4337 toggle and bridge normally.

  ## EntryPoint deposit

  The Paymaster must have ETH at the EntryPoint. Run after any new deployment:

  ```bash
  pnpm --filter @workspace/scripts run fund-paymaster
  pnpm --filter @workspace/scripts run fund-paymaster -- --only sepolia --amount 0.05
  pnpm --filter @workspace/scripts run fund-paymaster -- --only base   --amount 0.02
  pnpm --filter @workspace/scripts run fund-paymaster -- --only fuji   --amount 0.05
  ```

  Funded 2026-06-03:

  | Chain | ETH at EntryPoint |
  |---|---|
  | Ethereum Sepolia | ~0.048 ETH |
  | Base Sepolia | ~0.020 ETH |
  | Avalanche Fuji | ~0.050 ETH |

  ## Deployment constraints

  | Constraint | Reason |
  |---|---|
  | `evmVersion: "paris"` | Arc Testnet + Fuji reject PUSH0 (Shanghai opcode) |
  | `entryPoint` as `constant`, not `immutable` | 2-immutable 0x60c0 init silently reverts on Arc/Base/Fuji |
  | No `nonReentrant` on `validatePaymasterUserOp` | ERC-7562 forbids global storage writes for unstaked paymasters — Pimlico rejects at simulation |
  | Deposit ETH at EntryPoint before use | Bundler returns AA31 if deposit is 0 |
  | Update both address files after redeploy | `lib/paymaster.ts` + `api-server/routes/paymaster.ts` |

  ## Security

  - `onlyEntryPoint` on `validatePaymasterUserOp` and `postOp`
  - `onlyRelayer` on `deductGas`
  - `MAX_DEDUCTION_PER_TX = 10 USDC` hard cap per call
  - `locked[user]` prevents double-spending across concurrent UserOps
  - `withdraw()` only releases unlocked funds
  - Reentrancy guard on `deposit`, `withdraw`, `deductGas`, `postOp`
  - Emergency pause + two-step ownership
  - `rescueTokens` blocks USDC rescue
  