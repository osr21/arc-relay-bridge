# Architecture and product scope

Arc Relay Bridge transfers native USDC between Arc Mainnet and Base Mainnet
using Circle CCTP V2. It is non-custodial: the application never receives or
controls bridged funds.

## Enabled flow

1. Validate the route, amount, recipient, wallet chain, and destination gas.
2. Approve Circle's TokenMessenger to spend the exact required USDC.
3. Call the seven-parameter CCTP V2 `depositForBurn`.
4. Persist the burn hash immediately.
5. Read the source receipt and extract the emitted CCTP message.
6. Poll Circle's production Iris API for the matching attested message.
7. Verify immutable message fields and check whether its nonce was consumed.
8. Switch to the destination network and call `receiveMessage`.
9. Record completion and clear the resumable session.

The bridge uses finality threshold `2000`, `maxFee = 0`, and an unrestricted
destination caller. It charges no application fee.

## Reliability model

The source-chain receipt is authoritative. A wallet may return a transaction
hash and then fail while waiting for its receipt. When that happens, the app
polls static source RPC providers and keeps the submitted transfer resumable.

Source and Iris message bytes are not assumed to be identical. Correlation
checks immutable fields and fails closed if no unique match exists. Resume also
checks the attested nonce to avoid submitting a duplicate destination mint.

## Disabled products

Relay, gasless transactions, refuel, and yield are not part of the live bridge.
Their historical contracts and testnet experiments must not be interpreted as
mainnet deployments.

- Relay needs an authenticated payout design, reviewed deployment, durable
  idempotency, and funded operations.
- Gasless mode needs confirmed Arc Mainnet bundler support, paymaster review,
  sponsorship policy, and funding.
- Refuel needs durable payout reconciliation and chain-native liquidity.
- Yield needs a real reviewed strategy. Simulated APY is never presented as a
  mainnet investment return.

See [Mainnet validation](mainnet-validation.md) and
[Technical reference](technical-reference.md).