---
name: Arc Testnet MetaMask nativeCurrency config
description: Why the bridge registers Arc Testnet with USDC/USDC/18 — and why the "must use ETH" workaround was wrong
---

The correct `wallet_addEthereumChain` config for Arc Testnet is `nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }`.

**Why:** We flip-flopped on this (USDC→ETH→USDC in Aug 2026). Verified facts, per the circlefin/arc-node issue #95 discussion:
- MetaMask hard-rejects any `decimals` other than 18 (validator in `ethereum-chain-utils.js`). Non-negotiable.
- The symbol is only required to be a 1–6 char string; `ETH` is NOT special-cased. "Must use ETH" was a myth.
- Arc's native balance genuinely carries 18 decimals: `floor(eth_getBalance / 10^12) == balanceOf` on the USDC precompile `0x3600...0000` (verified live via multiple RPC endpoints). So USDC/18 renders the true amount — no 10^12 skew.
- The 10^12 skew is what a dapp gets if it formats the native balance with `formatUnits(x, 6)` — a dapp-side bug, never MetaMask.
- Circle docs, viem `arcTestnet`, and chainid.network all publish USDC/USDC/18.

**How to apply:** Never "fix" the Arc symbol to ETH. Expect two agreeing "USDC" rows in MetaMask (native gas + wallet_watchAsset ERC-20) — same funds, two lenses; the bridge shows a dismissible explainer for this. When formatting Arc native balances in UI code, always use 18 decimals.
