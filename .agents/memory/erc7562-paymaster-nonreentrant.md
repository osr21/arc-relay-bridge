---
name: ERC-7562 nonReentrant on validatePaymasterUserOp
description: Why nonReentrant on validatePaymasterUserOp violates ERC-7562 and causes Pimlico to reject UserOps at simulation for unstaked paymasters.
---

## The Rule

ERC-7562 (AA validation rules enforced by Pimlico and other bundlers):
- **Unstaked paymaster**: may only write to its own storage slots keyed on `userOp.sender` (sender-associated storage).
- `_locked` (reentrancy guard bool) is a global slot — NOT keyed on sender.
- Writing `_locked` inside `validatePaymasterUserOp` → Pimlico rejects with an error containing "validatePaymasterUserOp".

**Why:** The error looks identical to an on-chain revert and is caught by `friendlyError` as a generic "Paymaster rejected" message. The root cause is invisible without knowing ERC-7562 rules.

## The Fix

Remove `nonReentrant` from `validatePaymasterUserOp` (and optionally `postOp` — postOp is post-execution, not validation phase, so ERC-7562 does not restrict it).

`onlyEntryPoint` is sufficient: only the EntryPoint can call `validatePaymasterUserOp`, and the EntryPoint never re-enters its own validation phase.

**Why:** `nonReentrant` is redundant AND harmful on `validatePaymasterUserOp`. Leave it only on user-callable functions (`deposit`, `withdraw`, `deductGas`).

## Impact on gas estimation

After removing `nonReentrant`, `validatePaymasterUserOp` only writes `locked[user]` (sender-associated). Gas drops by ~22k (no `_locked` 0→1 SSTORE). `paymasterVerificationGasLimit: 100_000n` is safe.

## Staking as alternative

Staking the paymaster in the EntryPoint (`addStake`) allows global storage writes. But our Paymaster contract has no `addStake` function — staking would require a new contract version anyway. Removing `nonReentrant` is simpler and correct.
