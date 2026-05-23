# User Guide

## Prerequisites

- [MetaMask](https://metamask.io) browser extension installed
- Testnet USDC on the source chain (get it from [Circle's faucet](https://faucet.circle.com))
- Native gas tokens on both the source and destination chains:
  - **ETH** on Ethereum Sepolia and Base Sepolia (use a Sepolia faucet)
  - **AVAX** on Avalanche Fuji (use [faucet.avax.network](https://faucet.avax.network))
  - **USDC** on Arc Testnet (Arc uses USDC as its gas token)

## Step-by-step bridge

### 1. Connect your wallet

Click **Connect Wallet** in the top right. MetaMask will prompt you to connect — approve it.

### 2. Select chains

Choose your **source chain** (FROM) and **destination chain** (TO). You can click the ↕ swap button to quickly flip directions.

The app will show your USDC balance on each chain below the selectors.

### 3. Enter an amount

Type the amount of USDC to bridge. Click **MAX** to fill your full balance.

A fee breakdown will appear below showing:
- The 0.3% protocol fee deducted on the source chain
- The net amount you will receive on the destination chain

### 4. Bridge

Click **Bridge**. The app will walk you through up to 5 steps:

| Step | What happens |
|---|---|
| **Approve** | MetaMask asks you to approve the CCTP contract to spend your USDC. If you've approved a sufficient amount before, this step is skipped. |
| **Fee** | A small ERC-20 transfer sends the 0.3% protocol fee to the fee recipient. |
| **Burn** | MetaMask asks you to confirm the cross-chain burn transaction. This destroys your USDC on the source chain and emits the cross-chain message. |
| **Attest** | The app polls Circle's API every 5 seconds for a signed attestation. This typically takes 1–3 minutes. Do not close the tab. |
| **Mint** | MetaMask will prompt you to switch to the destination chain, then asks you to confirm the mint transaction. Your USDC arrives. |

### 5. After bridging

Once complete, a success screen shows links to each transaction. You'll also see an **Add USDC to wallet** button — click it to add the destination chain's USDC token to your MetaMask so it appears in your balance.

## Adding USDC manually to MetaMask

If USDC doesn't appear automatically in MetaMask, add it manually:

1. Open MetaMask and switch to the destination chain
2. Click **Import tokens**
3. Enter the USDC contract address for that chain (see [Technical Reference](./technical-reference.md))
4. Symbol: `USDC`, Decimals: `6`

## Getting testnet USDC

Visit [faucet.circle.com](https://faucet.circle.com):

1. Select the testnet chain
2. Enter your wallet address
3. Click **Send** — you'll receive test USDC in under a minute

## Timing

| Direction | Typical attestation time |
|---|---|
| Arc → any chain | 2–5 min |
| Sepolia → Arc | 2–5 min |
| Base Sepolia → any | 2–5 min |
| Fuji → any | 2–5 min |

Attestation times depend on Circle's Iris API and current testnet congestion. The app will wait up to 20 minutes before timing out. If it times out, your funds are safe — the burn is confirmed on-chain and you can complete the mint manually using [Circle's CCTP relayer](https://developers.circle.com/stablecoins/cctp-getting-started).

## Troubleshooting

| Problem | Solution |
|---|---|
| Balance shows 0 | Make sure MetaMask is unlocked and connected. The balance reads from the chain's RPC — try refreshing. |
| Burn transaction fails | Ensure you have enough gas (native token) on the source chain. |
| Stuck on Attest for >15 min | This is unusual. Check the burn tx on the source chain explorer to confirm it was mined. If it was, wait a bit longer or try refreshing the page. |
| MetaMask doesn't show USDC | Use the **Add USDC to wallet** button on the success screen, or add it manually (see above). |
| Arc explorer links don't open | The Arc Testnet block explorer is currently unavailable. Use the copy button to copy your transaction hash and save it for your records. |
