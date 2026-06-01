# Paymaster

The Paymaster contract enables gasless transactions on Arc Relay Bridge by letting users pay transaction fees in USDC instead of native gas tokens. It is compatible with [ERC-4337 v0.7](https://eips.ethereum.org/EIPS/eip-4337) and integrates with the canonical EntryPoint.

## Contract addresses (v3 — 2026-06-01)

| Chain | Address |
|---|---|
| Arc Testnet | [`0x3fAC0e0F8d8BfE9498d06332582C48Dc32698D65`](https://testnet.arcscan.app/address/0x3fAC0e0F8d8BfE9498d06332582C48Dc32698D65) |
| Ethereum Sepolia | [`0xfF57188ea392bA5e91bdf675AAA55f2D8Ba9BdBe`](https://sepolia.etherscan.io/address/0xfF57188ea392bA5e91bdf675AAA55f2D8Ba9BdBe) |
| Base Sepolia | [`0x3649C856025FDC0F92EDAc2B52DD53452248bA33`](https://sepolia.basescan.org/address/0x3649C856025FDC0F92EDAc2B52DD53452248bA33) |
| Avalanche Fuji | [`0xd9E34Aca62a16a58a4e7144130Be94bD908D368c`](https://testnet.snowtrace.io/address/0xd9E34Aca62a16a58a4e7144130Be94bD908D368c) |

**ERC-4337 v0.7 EntryPoint (all chains):** `0x0000000071727De22E5E9d8BAf0edAc6f37da032`

## How it works

Users deposit USDC into the Paymaster in advance. When a sponsored transaction is executed:

1. The ERC-4337 EntryPoint calls `validatePaymasterUserOp` — the Paymaster checks the user's available balance, reserves the worst-case gas cost in `locked`, and approves the UserOperation
2. The EntryPoint executes the user's call
3. The EntryPoint calls `postOp` — the Paymaster releases the reservation and charges the actual gas cost by deducting from `balances[user]`

For non-ERC-4337 flows (direct relayer), the trusted relayer calls `deductGas` after executing a transaction on the user's behalf.

```
User                 Paymaster           EntryPoint (ERC-4337 v0.7)
 │                       │                       │
 │  deposit(amount)      │                       │
 │──────────────────────►│                       │
 │                       │                       │
 │  (submit UserOp)      │  validatePaymasterUserOp
 │                       │◄──────────────────────│
 │                       │  lock worst-case cost  │
 │                       │──────────────────────►│
 │                       │                       │  execute user call
 │                       │   postOp(actualCost)  │
 │                       │◄──────────────────────│
 │                       │  unlock + deduct actual│
```

## Balances and reservations

| Mapping | Description |
|---|---|
| `balances[user]` | Total USDC deposited by the user (6-decimal units) |
| `locked[user]` | USDC reserved for in-flight UserOperations |

**Available balance** = `balances[user] - locked[user]`

The Paymaster only sponsors a UserOperation if `available >= maxCost` where `maxCost = verificationGasLimit * gasRate`.

## Gas rate

The relayer owner can set the rate at which gas is charged in USDC:

```solidity
function setGasRate(uint256 newRate) external onlyOwner
```

- Units: USDC 6-decimal units per gas unit
- Current rate: **2** (0.000002 USDC per gas unit)
- Maximum allowed rate: `MAX_GAS_RATE = 1_000_000` (1 USDC per gas unit)

## User operations

### Deposit

```solidity
function deposit(uint256 amount) external
```

Transfers `amount` USDC from the caller into the Paymaster. The caller must first approve the Paymaster to spend their USDC.

### Withdraw

```solidity
function withdraw(uint256 amount) external
```

Withdraws `amount` from the caller's balance. Only the unlocked portion (`balances - locked`) can be withdrawn.

### Check balance

```solidity
function balances(address user) external view returns (uint256)
function locked(address user) external view returns (uint256)
```

## Admin operations

All admin functions are `onlyOwner` (or `onlyRelayer` for `deductGas`).

| Function | Description |
|---|---|
| `setRelayer(address)` | Replace the trusted relayer |
| `setFeeRecipient(address)` | Change where collected fees go |
| `setGasRate(uint256)` | Adjust the USDC-per-gas rate (capped at `MAX_GAS_RATE`) |
| `pause()` / `unpause()` | Freeze or resume user-facing operations |
| `rescueTokens(token, to, amount)` | Recover accidentally sent tokens (USDC is blocked) |
| `transferOwnership(address)` | Initiate ownership transfer |
| `acceptOwnership()` | New owner must call to complete transfer |

## Security properties

| Property | Implementation |
|---|---|
| Reentrancy protection | `bool private _locked` mutex; `nonReentrant` modifier on all state-changing user functions |
| No USDC rescue | `rescueTokens` explicitly reverts if `token == usdc` |
| Gas rate cap | `setGasRate` reverts if `newRate > MAX_GAS_RATE` |
| Locked funds protection | `withdraw` reverts if `amount > balances[user] - locked[user]` |
| Two-step ownership | New owner must call `acceptOwnership()` to prevent accidental misdirection |
| Emergency pause | `deposit`, `withdraw`, `validatePaymasterUserOp`, `postOp`, `deductGas` all check `whenNotPaused` |

## Compilation requirements

The Paymaster must be compiled with `evmVersion: "paris"`:

- Arc Testnet and Avalanche Fuji reject the `PUSH0` opcode introduced in Shanghai/Cancun
- Hardhat config: `settings: { evmVersion: "paris" }`

**Critical:** Do not make `entryPoint` an `immutable` variable. Contracts with two or more `immutable` variables produce a `0x60c0` constructor prefix that silently reverts on Arc Testnet, Base Sepolia, and Avalanche Fuji. The `entryPoint` is hardcoded as a `constant` to keep the constructor at the safe single-immutable `0x60a0` pattern (only `usdc` is immutable).

## Deployment

Re-deploy to all chains:

```bash
pnpm --filter @workspace/scripts run deploy-paymaster
```

Deploy to specific chains only:

```bash
# Single chain
pnpm --filter @workspace/scripts run deploy-paymaster -- --only arc
pnpm --filter @workspace/scripts run deploy-paymaster -- --only sepolia

# Multiple chains (comma-separated, substring matched)
pnpm --filter @workspace/scripts run deploy-paymaster -- --only arc,fuji
```

Constructor parameters:

```solidity
constructor(
    address usdc,          // USDC token address on this chain
    address relayer,       // initial trusted relayer (deployer)
    address feeRecipient,  // address that receives collected fees
    uint256 gasRate        // initial USDC-per-gas rate (6-decimal units)
)
```

`entryPoint` is hardcoded to `0x0000000071727De22E5E9d8BAf0edAc6f37da032` (ERC-4337 v0.7) and requires no constructor argument.

Deployment output is written to `artifacts/arc-bridge/src/contracts/paymasterDeployments.json` and must be manually propagated to:

- `artifacts/arc-bridge/src/lib/paymaster.ts` — `PAYMASTER_ADDRESSES` map
- `artifacts/api-server/src/routes/paymaster.ts` — per-chain address in the `CHAINS` array
