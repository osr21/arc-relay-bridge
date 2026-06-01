---
name: Two-immutable constructor revert
description: Solidity contracts with 2 immutables (0x60c0 init) silently revert on Arc Testnet, Base Sepolia, and Avalanche Fuji.
---

**Rule:** Never use 2+ immutable state variables in a Paymaster (or any contract) deployed to Arc Testnet, Base Sepolia, or Avalanche Fuji.

**Why:** A 2-immutable Solidity contract generates `0x60c0` init code (free memory pointer starts at 0xC0 instead of 0xA0). On these three chains, the constructor transaction is mined with `status: 0` and `data: null` — no revert reason, but the code is never stored. The ERC-4337 canonical EntryPoint (`0x0000000071727De22E5E9d8BAf0edAc6f37da032`) is deployed via CREATE2 and is identical on every EVM chain, so it should always be declared as `address public constant entryPoint = ...` rather than `immutable`, keeping the single-immutable `0x60a0` init pattern.

**How to apply:** If you ever need to add a second `immutable` to a contract targeting these chains, convert it to a `constant` if the value is chain-universal, or to a regular `storage` variable if it must vary. Always verify the compiled bytecode starts with `0x60a0` (1 immutable) not `0x60c0` (2 immutables) before deploying.
