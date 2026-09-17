# Paymaster

> **Historical testnet documentation:** The paymaster and ERC-4337 gasless mode
> are disabled in the Arc↔Base mainnet application. Addresses in this document
> are not mainnet deployments and must not be used by the live bridge.

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

1. The ERC-4337 EntryPoint calls `validatePaymasterUserOp`, which reserves the maximum possible USDC cost in a `locked` mapping.
2. The user's UserOperation is executed (e.g. `depositForBurn` on the CCTP TokenMessenger).
3. The EntryPoint calls `postOp`, which releases the reservation and charges the actual gas cost in USDC (gas units × rate, capped at 10 USDC).

The legacy `deductGas` path (called directly by a trusted relayer) remains available alongside ERC-4337 for backward compatibility.

## Gasless bridge setup

The bridge UI provides a dedicated setup flow on the **Paymaster** page:

1. **Connect wallet** — your ERC-4337 SimpleAccount address is derived deterministically from your MetaMask EOA (counterfactual, no deployment needed upfront).
2. **Fund the SimpleAccount** — send USDC to that address from any source (Circle faucet, another wallet, etc.).
3. **Sponsored deposit** — click **Deposit (Sponsored)** on the Paymaster page. Pimlico pays the gas for the approve + deposit UserOperation; the USDC moves from your SimpleAccount into the Paymaster balance. No ETH needed.
4. **Bridge** — enable the **ERC-4337 gasless burn** toggle on the bridge. The burn UserOperation is submitted through Pimlico, with gas deducted from your Paymaster USDC balance.

> Arc Testnet uses USDC as its native gas token. ERC-4337 is not available as a source chain.

## Implementation details

| File | Role |
|---|---|
| `src/lib/aa.ts` | `isAASupported`, `getSmartAccountAddress`, `createBridgeClient` (Paymaster pays), `createSponsoredClient` (Pimlico pays) |
| `src/lib/gaslessBridge.ts` | `executeBridgeGasless`, `depositToPaymasterGasless` |
| `artifacts/api-server/src/routes/bundler.ts` | `/api/bundler/:network` — Pimlico JSON-RPC proxy (300 req/min) |

Supported networks for ERC-4337: `sepolia` (11155111), `base-sepolia` (84532), `avalanche-fuji` (43113).

## Contract interface (v0.7)

```solidity
// ERC-4337 v0.7
function validatePaymasterUserOp(
    PackedUserOperation calldata userOp,
    bytes32 userOpHash,
    uint256 maxCost
) external returns (bytes memory context, uint256 validationData);

function postOp(
    PostOpMode mode,
    bytes calldata context,
    uint256 actualGasCost,
    uint256 actualUserOpFeePerGas
) external;

// Legacy relayer path (unchanged from v2)
function deductGas(address user, uint256 gasUsed) external;

// User-facing
function deposit(uint256 amount) external;
function withdraw(uint256 amount) external;
function balanceOf(address user) external view returns (uint256);
function locked(address user) external view returns (uint256);
```

## Gas rate

The Paymaster charges users at a configurable `gasRate` (USDC per gas unit, 6-decimal). Each charge is capped at **10 USDC** per transaction. The rate is set by the owner and is hard-capped at `MAX_GAS_RATE` = 1 USDC/gas unit to protect users.

## Compilation constraints

- **`evmVersion: "paris"`** — Arc Testnet and Avalanche Fuji reject the `PUSH0` opcode introduced in the Shanghai hardfork.
- **`entryPoint` must be a `constant`, not `immutable`** — contracts with two or more `immutable` variables use a `0x60c0` constructor prefix that silently reverts on Arc Testnet, Base Sepolia, and Avalanche Fuji. Keeping only `usdc` as `immutable` (single `0x60a0` prefix) is required for cross-chain compatibility.

## Re-deploying

```bash
# Deploy to all chains
pnpm --filter @workspace/scripts run deploy-paymaster

# Deploy to a subset
pnpm --filter @workspace/scripts run deploy-paymaster -- --only sepolia
pnpm --filter @workspace/scripts run deploy-paymaster -- --only arc,fuji
```

Constructor: `(address usdc, address relayer, address feeRecipient, uint256 gasRate)` — 4 params; `entryPoint` is a hardcoded constant.

After deploying, update `PAYMASTER_ADDRESSES` in `artifacts/arc-bridge/src/lib/paymaster.ts`.

## Admin operations

| Function | Access | Description |
|---|---|---|
| `setRelayer(address)` | Owner | Update the trusted relayer address |
| `setFeeRecipient(address)` | Owner | Update where gas fees are sent |
| `setGasRate(uint256)` | Owner | Update USDC-per-gas rate (capped at MAX_GAS_RATE) |
| `pause()` / `unpause()` | Owner | Freeze / resume all user operations |
| `rescueTokens(address,uint256)` | Owner | Recover accidentally sent tokens (USDC rescue is blocked) |
| `transferOwnership(address)` | Owner | Begin two-step ownership transfer |
| `acceptOwnership()` | Pending owner | Complete ownership transfer |
