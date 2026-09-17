# Arc ↔ Base mainnet technical reference

## Network and contract configuration

| Property | Arc Mainnet | Base Mainnet |
|---|---|---|
| Chain ID | `5042` | `8453` |
| CCTP domain | `26` | `6` |
| RPC | `https://rpc.mainnet.arc.io` | `https://mainnet.base.org` |
| Explorer | `https://explorer.arc.io` | `https://basescan.org` |
| USDC | `0x3600000000000000000000000000000000000000` | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| Finality threshold | `2000` | `2000` |

Both routes use Circle's mainnet CCTP V2 contracts:

| Contract | Address |
|---|---|
| TokenMessenger | `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d` |
| MessageTransmitter | `0x81D40F21F12A8F0E3252Bccb954D722d4c464B64` |

The Arc USDC system address exposes a six-decimal ERC-20 interface. Arc wallet
network metadata describes its native gas currency as USDC with 18 native
decimals; applications must not use that value for ERC-20 amount conversion.

## CCTP V2 burn

```solidity
function depositForBurn(
    uint256 amount,
    uint32 destinationDomain,
    bytes32 mintRecipient,
    address burnToken,
    bytes32 destinationCaller,
    uint256 maxFee,
    uint32 minFinalityThreshold
) returns (uint64 nonce);
```

Enabled bridge parameters:

- `amount`: six-decimal USDC units
- `mintRecipient`: recipient address left-padded to 32 bytes
- `destinationCaller`: zero bytes32, allowing anyone to submit the mint
- `maxFee`: `0`; Fast Transfer is not requested
- `minFinalityThreshold`: `2000`

The bridge uses raw `eth_call` for burn preflight. Arc can return empty success
data for a successful write simulation; ABI-decoding that empty return as a
`uint64` can incorrectly report `BAD_DATA`.

## Production Iris

Base URL:

```text
https://iris-api.circle.com
```

The bridge queries the transaction endpoint and correlates returned messages
with the source `MessageSent` log. It does not assume that source and attested
message bytes are identical.

## Receipt and resume invariants

- A displayed burn transaction hash means a transaction was submitted.
- Wallet RPC HTTP 403, `-32080`, timeout, connection, or coalescing errors after
  broadcast are treated as recoverable receipt-wait failures.
- Static source RPCs are used to retrieve the authoritative receipt.
- An in-progress session stores the route, amount, recipient, burn hash, source
  message identity, and any available message bytes.
- Resume re-fetches and verifies the source receipt.
- Mint replay checks use the nonce from the attested message.
- The UI must not offer a new transfer while an unresolved burn hash exists.

## Gas requirements

Users need source-chain gas for approval and burn and destination-chain gas for
`receiveMessage`. Arc gas is paid with Arc's native USDC representation; Base
gas is paid with ETH. The app performs destination reserve checks before burn.

## Official sources

- [Arc network settings](https://docs.arc.io/arc/references/connect-to-arc)
- [Circle CCTP addresses](https://developers.circle.com/cctp/references/contract-addresses)
- [Circle USDC addresses](https://developers.circle.com/stablecoins/usdc-contract-addresses)
- [Base network settings](https://docs.base.org/get-started/connect-to-base)