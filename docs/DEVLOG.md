# Arc Relay Bridge — Development Log

A running record of features built, bugs discovered, and protocol-level findings on Arc Testnet. Issues filed in [circlefin/arc-node](https://github.com/circlefin/arc-node) are linked where relevant.

---

## Gas Refuel Feature

**What it is:** Users spend Arc Testnet USDC and receive native gas (ETH or AVAX) on Ethereum Sepolia, Base Sepolia, or Avalanche Fuji — no bridging required.

**Flow:**
1. Frontend fetches a live quote (CoinGecko price, 5% service fee, 120 s TTL)
2. User signs a USDC `transfer` to the relayer's deposit address on Arc Testnet
3. Frontend submits the Arc tx hash + destination chain + recipient to `POST /api/gasrefuel/submit`
4. API verifies the on-chain transfer (logs scan for `Transfer` event to deployer address), calculates the payout, checks relayer liquidity, then sends native gas

**Pricing formula:**
```
nativeWei = (usdcUnits × 10^30 × (10000 - feeBps)) / (nativeRate × 10000)
```
where `nativeRate` is a 1e18-scaled USD price from CoinGecko (Band Protocol oracle on Arc only has USDC/USD).

**Security properties implemented:**
- Replay protection via two-set pattern: `pendingArcTxHashes` (in-flight) + `usedArcTxHashes` (fulfilled)
- Concurrent duplicate requests both fail 409 — prevents race-condition double-spend
- Zero-payout guard: `nativeWei === 0n` check before any funds move (price feed anomaly protection)
- Frontend USDC balance check before sending (blocks MetaMask tx submission when balance insufficient)
- Input validation: tx hash regex, address checksum, chain whitelist, USDC unit bounds (0.5–10)
- Rate limiting via `express-rate-limit` on all API routes

**Arc-specific notes:**
- Band Protocol oracle on Arc Testnet (`0x8c064bCf7C0DA3B3b090BAbFE8f3323534D84d68`) only has USDC/USD; ETH/USD and AVAX/USD return `REFDATANOTAVAILABLE` → use CoinGecko free API
- Chain-switch: `wallet_switchEthereumChain` first, `wallet_addEthereumChain` only on 4902 — avoids `nativeCurrency.symbol` mismatch error when user already has Arc Testnet in MetaMask

---

## Paymaster v5 (ERC-4337 Gasless Bridging)

**Contract:** Deployed to all four chains. Constructor: `(address usdc, address relayer, address feeRecipient, uint256 gasRate)`. EntryPoint is a `constant` (not `immutable`).

| Chain | Address |
|---|---|
| Arc Testnet | `0xfD06D288d481515a986DF28030AF013De290D76C` |
| Ethereum Sepolia | `0xC9E9ba0bfE58FA438B8B6f2182d3ADA3669F9Eb4` |
| Base Sepolia | `0xe355E9dCdEAB37eA8fd81b9457Ad2C56d3eE9055` |
| Avalanche Fuji | `0x7C75A75B59b63871e1Bb47fA63e541F0e5975f93` |

**Key bugs found and fixed during development (all Arc/ERC-4337 specific):**

### v4 fix — `nonReentrant` on `validatePaymasterUserOp` violates ERC-7562
ERC-7562 forbids global storage writes in `validatePaymasterUserOp` for unstaked paymasters. The `nonReentrant` modifier from OpenZeppelin sets a global `_locked` boolean — this write causes Pimlico (and compliant bundlers) to reject the UserOp at simulation with no clear error. `onlyEntryPoint` is sufficient protection because the EntryPoint contract never re-enters validation.

```solidity
// ❌ v3 and earlier — ERC-7562 violation, Pimlico rejects at simulation
function validatePaymasterUserOp(...) external nonReentrant onlyEntryPoint returns (...) {

// ✅ v4+ — onlyEntryPoint is sufficient; no global storage writes in validation
function validatePaymasterUserOp(...) external onlyEntryPoint returns (...) {
```

### v5 fix — `deductGas` double-charge on concurrent UserOps
`deductGas` must check only the *available* (unlocked) balance, not the total balance. When two UserOps from the same user are in-flight simultaneously, the first reserves funds; the second must not double-count those reserves.

### Constructor: `constant` vs `immutable` for EntryPoint
The EntryPoint address must be `constant`, not `immutable`. Two `immutable` variables produce a `0x60c0` init-code prefix that silently reverts on Arc Testnet, Avalanche Fuji, and Base Sepolia (see arc-node#109). A single `immutable` (`0x60a0`) works everywhere.

```solidity
// ❌ Two immutables — 0x60c0 init, silently reverts on Arc/Fuji/Base
IEntryPoint public immutable entryPoint;
address public immutable usdc;

// ✅ One constant + one immutable — 0x60a0 init, works everywhere
IEntryPoint public constant entryPoint = IEntryPoint(0x0000000071727De22E5E9d8BAf0edAc6f37da032);
address public immutable usdc;
```

---

## FeeRouter v2

Hardened over v1: immutable `usdc`/`tokenMessenger` (no caller-supplied addresses), reentrancy lock, zero `mintRecipient` check, `rescueTokens` return-value check.

| Chain | Address |
|---|---|
| Arc Testnet | `0x8256a1e1f8971448b49dA0F55b8A1BB6557eA8FC` |
| Ethereum Sepolia | `0x5B1F511ed4dF76f369671BF1c4aCF0dD84CC0804` |
| Base Sepolia | `0x8d4B57eD464df10414Dde3ADC2E403a01ebc50d8` |
| Avalanche Fuji | `0x64D160b7E91e78e52dFc0e8829640E32A919164C` |

---

## MetaMask Chain-Switch Pattern (arc-node#130)

The bug: `wallet_addEthereumChain` throws `"nativeCurrency.symbol does not match"` when the chain is already in MetaMask. The fix that works reliably across Arc Testnet, Sepolia, Base, and Fuji:

```typescript
async function switchToChain(chain: ChainConfig): Promise<void> {
  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: chain.hexId }],
    });
    // Verify switch committed (Arc Testnet returns success before RPC router switches)
    const current = await getWalletChainId();
    if (current !== chain.id) await addChainFallback(chain);
  } catch (err) {
    if ((err as { code?: number }).code === 4001) throw err; // user rejected
    await addChainFallback(chain); // 4902 = unknown chain, or Arc-specific failure
  }
}
```

Key: `wallet_switchEthereumChain` first avoids the symbol-mismatch error entirely (no params sent = no conflict). Fall back to `wallet_addEthereumChain` only when the chain is completely unknown (4902).

---

## Arc Testnet Protocol Findings

All findings were filed as issues in [circlefin/arc-node](https://github.com/circlefin/arc-node).

| # | Finding | Status |
|---|---|---|
| [#108](https://github.com/circlefin/arc-node/issues/108) | `eth_estimateGas` returns `data:null` for CCTP calls — hardcode `{ gasLimit: 600_000n }` | Open |
| [#109](https://github.com/circlefin/arc-node/issues/109) | PUSH0 opcode rejected; must use `evmVersion: "paris"`; two-immutable constructor silently reverts | Open |
| [#110](https://github.com/circlefin/arc-node/issues/110) | CCTP V2 domain 26, `minFinalityThreshold` 2000, V1 selector incompatible | Open |
| [#111](https://github.com/circlefin/arc-node/issues/111) | `eth_gasPrice` stale — sequential txs need ≥ 30% bump | Open |
| [#112](https://github.com/circlefin/arc-node/issues/112) | Arc Relay Bridge ecosystem post | Open |
| [#130](https://github.com/circlefin/arc-node/issues/130) | MetaMask RPC router race after chain switch | Open |

---

## Security Audit (API Server)

Completed May 2026. Findings and fixes:

| Finding | Fix |
|---|---|
| `ws` dependency vulnerable to ReDoS | Pinned `ws ≥ 8.20.1` via pnpm workspace override |
| Missing security headers | Added `helmet()` to Express app |
| Unbounded request body | Added `express.json({ limit: "50kb" })` |
| Bundler proxy no timeout | Added `AbortSignal.timeout(20_000)` |
| Relay route no RPC timeout | Added 6 s per-RPC deadline |
| Message/attestation inputs unbounded | Added 2500/270 char length caps |
| Gasrefuel replay race condition | Added `pendingArcTxHashes` concurrent lock |
| Zero-payout on price feed glitch | Added `nativeWei === 0n` guard |
