# Development guide

## Mainnet-first constraints

The bridge runtime supports Arc Mainnet and Base Mainnet only. The configuration
is pinned in `lib/arc-relay-sdk/src/mainnet.ts`. There is no environment switch
that unlocks testnets or disabled services.

Historical testnet contracts and scripts remain isolated development material.
Do not import their deployment manifests into the mainnet frontend.

## Project structure

```text
artifacts/arc-bridge/              React + Vite bridge
  src/lib/bridge.ts                approve, burn, attest, mint, resume
  src/lib/chains.ts                mainnet chain adapter
  src/lib/session.ts               validated local resume session
  src/pages/BridgePage.tsx         bridge and recovery UI
lib/arc-relay-sdk/src/mainnet.ts   public mainnet configuration and feature gates
artifacts/api-server/              optional server routes; not a bridge custodian
scripts/                           probes, tests, and historical deployment tooling
docs/                              architecture, validation, and protocol notes
```

## Run and verify

```bash
pnpm install
pnpm --filter @workspace/arc-bridge run dev

pnpm --filter @workspace/arc-bridge run typecheck
pnpm --filter @workspace/scripts exec tsx --test \
  ../artifacts/arc-bridge/src/lib/bridge.mainnet.test.ts
pnpm --filter @workspace/arc-bridge run build
```

The enabled bridge executes in the browser through the connected wallet. It
uses public source and destination RPCs plus Circle's production Iris API.

## Secrets

No secret is required for standard frontend bridge development. `.env.example`
documents optional server and contract-development variables. Store real values
in Replit Secrets or an equivalent secret manager; never place them in source
files, shell history, documentation, issue bodies, or screenshots.

`DEPLOYER_PRIVATE_KEY` is never needed to run the standard bridge and must not
be used without explicit authorization for a separately reviewed deployment.

## Changing bridge behavior

Any route or CCTP change must preserve:

1. Official mainnet chain IDs, CCTP domains, USDC addresses, and contracts
2. Exact six-decimal ERC-20 amount conversion
3. Recipient and destination-domain validation
4. Session persistence as soon as a burn hash exists
5. Receipt-authoritative recovery after wallet RPC errors
6. Unique source/Iris message correlation
7. Attested nonce replay checks
8. Destination gas checks before burn
9. No application fee unless separately approved

Run the full bridge test file after any change to these invariants.

## Mainnet canaries

Automated checks must not send mainnet transactions. A live canary requires
explicit authorization, a deliberately limited amount, verified official
addresses, sufficient gas on both chains, and manual transaction review. Record
public transaction hashes and results in `docs/mainnet-validation.md`.

## Deferred capability development

Relay, gasless, refuel, and yield code must stay inaccessible from mainnet
runtime while it is being researched. Each requires a separate threat model,
tests, independent review, verified deployment, and operating policy before its
feature gate can change.