# Technical Reference

## Contract addresses

All four chains share the same CCTP V2 contract addresses:

| Contract | Address |
|---|---|
| TokenMessenger (CCTP V2) | `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA` |
| MessageTransmitter (CCTP V2) | `0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275` |

### USDC token addresses

| Chain | USDC Address |
|---|---|
| Arc Testnet | `0x3600000000000000000000000000000000000000` |
| Ethereum Sepolia | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` |
| Base Sepolia | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
| Avalanche Fuji | `0x5425890298aed601595a70AB815c96711a31Bc65` |

> Arc Testnet USDC is at a special system address. It always uses 6 decimals via the ERC-20 interface regardless of any native 18-decimal representation.

## CCTP V2 function signature

All chains use the 7-parameter V2 `depositForBurn`:

```solidity
function depositForBurn(
    uint256 amount,              // USDC amount in 6-decimal units
    uint32  destinationDomain,   // CCTP domain of destination chain
    bytes32 mintRecipient,       // recipient address zero-padded to 32 bytes
    address burnToken,           // USDC token address on source chain
    bytes32 destinationCaller,   // bytes32(0) = anyone may relay
    uint256 maxFee,              // 0 = no fast-finality premium
    uint32  minFinalityThreshold // finality level (see below)
) returns (uint64 nonce)
```

Function selector: `0x8e0250ee`

> The older V1 selector `0x6fd3504e` (4-param version) is **not supported** by these contracts and will revert with `require(false)`.

## Finality thresholds

The `minFinalityThreshold` parameter controls how many block confirmations Circle requires before issuing an attestation:

| Value | Meaning | Typical wait |
|---|---|---|
| 2000 | Fully finalized | ~12–15 min on Ethereum |
| 1000 | Safe block | ~1–2 min |
| 0 | Fast (optimistic) | Seconds |

Configured per chain:

| Chain | Threshold | Rationale |
|---|---|---|
| Arc Testnet | 2000 | Finalized — Arc finalizes quickly |
| Ethereum Sepolia | 1000 | Safe — 2000 would take 12+ min |
| Base Sepolia | 1000 | Safe |
| Avalanche Fuji | 1000 | Safe |

## Attestation API

Circle's sandbox Iris API is polled for attestations:

```
Base URL: https://iris-api-sandbox.circle.com

# By transaction hash (used while waiting)
GET /v2/messages/{sourceDomain}?transactionHash={txHash}

# By message hash (keccak256 of raw message bytes)
GET /v1/attestations/{messageHash}
```

Both endpoints are tried each polling round. Polling interval is 5 seconds with a 20-minute timeout.

### Status values

| Status | Meaning |
|---|---|
| `pending_confirmations` | Burn detected, waiting for finality |
| `complete` | Attestation signed and ready |

## Message parsing

After `depositForBurn` is called, the `MessageTransmitter` emits a `MessageSent(bytes message)` event. The raw `message` bytes are:

1. Parsed from the burn transaction receipt
2. Hashed (`keccak256`) to get the `messageHash` for the hash-based attestation endpoint
3. Passed to `receiveMessage(bytes message, bytes attestation)` on the destination chain

## RPC endpoints

| Chain | RPC URL |
|---|---|
| Arc Testnet | `https://rpc.drpc.testnet.arc.network` |
| Ethereum Sepolia | `https://ethereum-sepolia-rpc.publicnode.com` |
| Base Sepolia | `https://sepolia.base.org` |
| Avalanche Fuji | `https://api.avax-test.network/ext/bc/C/rpc` |

> `rpc.sepolia.org` is unreliable and should not be used.

## API server proxy

A lightweight Express server at `/api` proxies attestation requests to avoid browser CORS restrictions:

```
GET /api/attest?domain={domain}&txHash={hash}
  → proxies to Iris /v2/messages/{domain}?transactionHash={hash}
     with fallback to /v1/messages/{domain}/{hash}

GET /api/attest/hash/{messageHash}
  → proxies to Iris /v1/attestations/{messageHash}
```

## Paymaster (ERC-4337 v0.7)

The Paymaster allows users to pay gas fees in USDC rather than native tokens. See [docs/paymaster.md](./paymaster.md) for full architecture and admin documentation.

### Deployed addresses (v3 — 2026-06-01)

| Chain | Address |
|---|---|
| Arc Testnet | `0x3fAC0e0F8d8BfE9498d06332582C48Dc32698D65` |
| Ethereum Sepolia | `0xfF57188ea392bA5e91bdf675AAA55f2D8Ba9BdBe` |
| Base Sepolia | `0x3649C856025FDC0F92EDAc2B52DD53452248bA33` |
| Avalanche Fuji | `0xd9E34Aca62a16a58a4e7144130Be94bD908D368c` |

**ERC-4337 v0.7 EntryPoint (all chains):** `0x0000000071727De22E5E9d8BAf0edAc6f37da032`

### Compilation constraint

All Paymaster deployments use `evmVersion: "paris"`. Arc Testnet and Avalanche Fuji reject the `PUSH0` opcode (`0x5f`) introduced in Shanghai. Additionally, `entryPoint` must remain a `constant` (not `immutable`) — contracts with two or more `immutable` variables generate a `0x60c0` constructor init prefix that silently reverts on Arc Testnet, Base Sepolia, and Avalanche Fuji.

### FeeRouter addresses (v2 — 2025-05-23)

| Chain | Address |
|---|---|
| Arc Testnet | `0x8256a1e1f8971448b49dA0F55b8A1BB6557eA8FC` |
| Ethereum Sepolia | `0x5B1F511ed4dF76f369671BF1c4aCF0dD84CC0804` |
| Base Sepolia | `0x8d4B57eD464df10414Dde3ADC2E403a01ebc50d8` |
| Avalanche Fuji | `0x64D160b7E91e78e52dFc0e8829640E32A919164C` |
