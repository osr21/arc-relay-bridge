# GasRelayerV2 mainnet relay protocol

`GasRelayerV2` is a new, versioned relay contract for CCTP V2. It does not
replace, upgrade, or share an ABI artifact with the existing `GasRelayer`
deployment. Mainnet integrations must wait for a separately reviewed,
deployed `GasRelayerV2` configuration; this document does not authorize a
deployment or any transaction signing.

## Source-chain encoding

Call Circle CCTP V2 `TokenMessengerV2.depositForBurnWithHook` with this
interface and argument order:

```solidity
function depositForBurnWithHook(
    uint256 amount,
    uint32 destinationDomain,
    bytes32 mintRecipient,
    address burnToken,
    bytes32 destinationCaller,
    uint256 maxFee,
    uint32 minFinalityThreshold,
    bytes calldata hookData
) external returns (uint64 nonce);
```

For a destination `GasRelayerV2 relay`, payout wallet `recipient`, and user
fee ceiling `maxRelayFee`, the required values are:

```solidity
mintRecipient     = bytes32(uint256(uint160(address(relay))));
destinationCaller = bytes32(uint256(uint160(address(relay))));
hookData          = abi.encode(address(recipient), uint256(maxRelayFee));
```

`hookData` is exactly 64 bytes: one ABI word containing the left-zero-padded
address and one ABI word containing `maxRelayFee`. Do not use
`abi.encodePacked`, append extra hook fields, or use a zero recipient.
`maxFee` is Circle's CCTP protocol fee field and is separate from the
application's `maxRelayFee` encoded in `hookData`.

## Destination relay ABI and validation

Relayer services retain the client-facing call shape:

```solidity
function relay(
    bytes calldata message,
    bytes calldata attestation,
    address recipient,
    uint256 maxFee
) external;
```

`recipient` and `maxFee` must exactly equal the authenticated
`abi.encode(address,uint256)` hook values. The service must submit the raw
Circle-attested message and attestation without rewriting either. The contract
then calls its immutable configured Circle `MessageTransmitter.receiveMessage`
for attestation, CCTP validity, and replay validation.

Before that external call, the contract only accepts this exact CCTP V2 layout
(all offsets are zero-indexed):

| Field | Offset | Required value |
| --- | ---: | --- |
| Message header | `0..147` | 148-byte CCTP V2 header |
| Header version | `0..3` | `uint32(1)` |
| `destinationCaller` | `108..139` | `bytes32(address(relay))` |
| BurnMessageV2 body | `148..375` | fixed 228-byte body |
| Burn body version | `148..151` | `uint32(1)` |
| `mintRecipient` | `184..215` | `bytes32(address(relay))` |
| Application hook | `376..439` | `abi.encode(recipient, maxRelayFee)` |

The resulting message must be **exactly 440 bytes**. The receiver also
requires `relayFee() <= maxRelayFee` and a minted balance delta strictly
greater than `relayFee()`. It transfers the bounded fee to `feeRecipient()`
and the remainder only to the hook-bound recipient.

`destinationCaller` is deliberately the relay address. Circle's destination
`MessageTransmitter` therefore rejects a direct external
`receiveMessage` attempt; only the relay contract can make that call. This
prevents a separately minted balance from becoming stuck in the relay.

## Configuration-verification ABI

Before integration, independently verify the deployed runtime, the immutable
`usdc()` and `messageTransmitter()` addresses against Circle's official chain
configuration, and all of the following getters:

```solidity
function protocolVersion() external pure returns (string memory);
function RELAYER_PROTOCOL_VERSION() external view returns (string memory);
function CCTP_MESSAGE_VERSION() external view returns (uint32); // 1
function BURN_MESSAGE_VERSION() external view returns (uint32); // 1
function CCTP_V2_RELAY_MESSAGE_LENGTH() external view returns (uint256); // 440
function MAX_RELAY_FEE() external view returns (uint256); // 5_000_000
function relayFee() external view returns (uint256);
function feeRecipient() external view returns (address);
function usdc() external view returns (address);
function messageTransmitter() external view returns (address);
```

The constructor rejects zero addresses, a USDC address without code, a
MessageTransmitter address without code, and a fee above `MAX_RELAY_FEE`.
The MessageTransmitter is immutable after deployment. Code existence is only a
deployment sanity check: operators must independently pin the official Circle
address and code/configuration for each target chain.

## Migration

Do not send a V2 hook burn to the legacy `GasRelayer`: it does not authenticate
the external recipient argument and has a different deployed ABI/artifact.
Conversely, existing/old burns are not accepted by `GasRelayerV2`, which
requires the CCTP V2 versions and the exact 440-byte application message.
Old burns remain a legacy **testnet-only** operational path until they are
settled under its existing process; do not migrate or represent them as
mainnet V2 relays.

The local `test:gas-relayer-v2` suite uses a mock transmitter strictly to
exercise malformed-message, replay, direct-caller, and reentrancy paths. The
mock does not validate Iris attestations and is not proof of Circle protocol
behavior. Production safety depends on the reviewed deployment using Circle's
real MessageTransmitter.

The header and body offsets above were checked against Circle's
[`MessageV2`](https://github.com/circlefin/evm-cctp-contracts/blob/master/src/messages/v2/MessageV2.sol)
and
[`BurnMessageV2`](https://github.com/circlefin/evm-cctp-contracts/blob/master/src/messages/v2/BurnMessageV2.sol)
source layouts. Reconfirm the official release and deployed contracts at
integration time.