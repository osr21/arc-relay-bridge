# Arc Relay Bridge — Overview

Arc Relay Bridge is a cross-chain USDC transfer application built on [Circle's CCTP V2](https://developers.circle.com/stablecoins/cctp-getting-started). It lets users burn native USDC on one chain and mint it natively on another — no wrapped tokens, no liquidity pools, no counterparty risk.

## How it works

```
User on Chain A                  Circle Iris API              User on Chain B
      │                                │                             │
      │  1. Approve USDC               │                             │
      │  2. depositForBurn()           │                             │
      │──────────────────────────────► │                             │
      │                                │  3. Issue attestation       │
      │                                │◄────────────────────────────│
      │  4. Poll for attestation       │                             │
      │◄──────────────────────────────►│                             │
      │                                │                             │
      │  5. Switch wallet to Chain B   │                             │
      │  6. receiveMessage()           │                             │
      │────────────────────────────────────────────────────────────► │
      │                                │             USDC minted ✓   │
```

### Step by step

1. **Approve** — The user approves the CCTP TokenMessenger contract to spend their USDC
2. **Fee** — A 0.3% protocol fee is transferred to the fee recipient wallet on the source chain
3. **Burn** — `depositForBurn()` is called on the source chain's TokenMessenger, destroying the USDC and emitting a cross-chain message
4. **Attest** — Circle's Iris API monitors the source chain and signs an attestation once sufficient block finality is reached
5. **Mint** — The bridge polls for the attestation, then calls `receiveMessage()` on the destination chain's MessageTransmitter, minting native USDC to the recipient

The whole flow is non-custodial: at no point does the bridge hold user funds.

## Supported chains

| Chain | CCTP Domain | Chain ID |
|---|---|---|
| Arc Testnet | 26 | 5042002 |
| Ethereum Sepolia | 0 | 11155111 |
| Base Sepolia | 6 | 84532 |
| Avalanche Fuji | 1 | 43113 |

Every pair is supported bidirectionally (6 possible routes).

## Protocol fee

A 0.3% fee is deducted from the transferred amount on the source chain before the burn. The fee is sent directly to the configured fee recipient wallet via a plain ERC-20 transfer — no smart contract required.

- Fee: 0.3% (30 basis points)
- Collected on: source chain, before burn
- Recipient: configurable via `VITE_FEE_RECIPIENT` environment variable
