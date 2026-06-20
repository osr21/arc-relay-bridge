# Contributing to Arc Relay Bridge

Thanks for your interest in contributing! This is an open-source reference implementation of Circle's CCTP V2 for the Arc ecosystem.

## What you can contribute

- **Bug reports** — open an issue with the chain, step (Approve/Burn/Attest/Mint), and error message
- **Chain support** — add new CCTP V2 supported chains by extending `artifacts/arc-bridge/src/lib/chains.ts`
- **Contract improvements** — Paymaster, GasRelayer, YieldVault, and FeeRouter live in `scripts/src/contracts/`
- **UI improvements** — all pages are in `artifacts/arc-bridge/src/pages/`

## Setup

```bash
git clone https://github.com/osr21/arc-relay-bridge.git
cd arc-relay-bridge
pnpm install
pnpm --filter @workspace/arc-bridge run dev
```

Get testnet USDC from [faucet.circle.com](https://faucet.circle.com). Arc Testnet, Sepolia, Base Sepolia, and Fuji are all supported.

## Adding a new chain

1. Add chain config to `artifacts/arc-bridge/src/lib/chains.ts` — include CCTP domain, RPC, USDC address, explorer URL, and `minFinalityThreshold`
2. Deploy Paymaster/GasRelayer/FeeRouter/YieldVault: `pnpm --filter @workspace/scripts run deploy-all`
3. Update deployed addresses in `artifacts/arc-bridge/src/lib/chains.ts`
4. Test the full bridge flow in both directions

## Smart contract notes

- Compile with `evmVersion: "paris"` — Arc Testnet and Fuji reject PUSH0 (Shanghai opcode)
- Keep `entryPoint` as `constant` not `immutable` — the 2-immutable (`0x60c0`) init pattern silently reverts on Arc/Base/Fuji
- Do NOT use `nonReentrant` on `validatePaymasterUserOp` — violates ERC-7562 for unstaked paymasters (Pimlico rejects silently)

## Resources

- [Arc Developer Docs](https://docs.arc.io)
- [CCTP V2 Docs](https://developers.circle.com/stablecoins/cctp-getting-started)
- [Circle App Kit](https://docs.arc.io/app-kit)
- [Build on Arc Discord](https://discord.com/invite/buildonarc)
