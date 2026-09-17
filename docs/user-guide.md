# Mainnet user guide

## Before transferring

You need:

- A browser wallet such as MetaMask
- Native USDC on the source network
- Source-network gas for approval and burn
- Destination-network gas for mint

Arc uses USDC for native gas. Base uses ETH for gas. The bridge checks the
destination reserve before allowing the burn, but you should verify both
balances yourself.

This bridge moves real funds. Confirm that the selected networks are Arc Mainnet
and Base Mainnet and review every wallet prompt.

## Transfer steps

1. Connect the wallet that holds the source USDC.
2. Select Arc or Base as the source; the other becomes the destination.
3. Enter an amount and, if needed, a custom recipient.
4. Review the route and destination gas check.
5. Approve Circle's TokenMessenger to spend the required USDC.
6. Confirm the CCTP burn transaction.
7. Wait while Circle produces the production attestation.
8. Switch to the destination network when prompted.
9. Confirm the CCTP mint transaction.

The enabled bridge charges no application fee. Wallet gas costs still apply.

## If an error appears after burn

If the app displays a burn transaction hash, **do not start another transfer**.
A wallet RPC can fail after it has already broadcast the transaction.

1. Save the burn transaction hash.
2. Reload the app and connect the same wallet.
3. Choose **Resume submitted transfer**.
4. Let the app retrieve the authoritative source receipt.
5. Complete the destination mint when prompted.

Resume also checks whether the CCTP nonce was already consumed. This lets it
recognize an existing mint instead of creating a duplicate destination action.

## Transaction stages

| Stage | Meaning |
|---|---|
| Approve | Authorizes Circle's TokenMessenger to spend the required source USDC |
| Burn | Destroys source USDC and emits the CCTP cross-chain message |
| Attest | Circle Iris verifies finality and signs the message |
| Mint | Destination MessageTransmitter verifies the message and mints native USDC |

Once a burn is confirmed, the operation completes through destination minting;
the source burn is not reversed.

## Add USDC to the wallet

If destination USDC is not displayed automatically, use the app's **Add USDC to
wallet** action or import the correct six-decimal token:

- Arc: `0x3600000000000000000000000000000000000000`
- Base: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`

## Disabled services

Relay, ERC-4337 gasless mode, refuel, and yield are not available in the
mainnet application. There is no testnet switch.

## Troubleshooting

| Problem | Action |
|---|---|
| Balance is zero | Confirm the connected account and network, then refresh |
| Approval or burn fails without a burn hash | Check source USDC and gas, then retry |
| Error appears with a burn hash | Do not reburn; reload and resume the submitted transfer |
| Attestation takes longer than expected | Check the burn receipt and continue waiting or resume later |
| Mint cannot start | Add destination gas and resume |
| USDC is not visible after mint | Import the destination USDC token or use the in-app action |

For verified network and contract addresses, see the
[Technical reference](technical-reference.md).