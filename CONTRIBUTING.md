# Contributing to Arc ↔ Base CCTP V2 Bridge

Contributions that improve the safety, reliability, accessibility, or
documentation of the standard mainnet bridge are welcome.

## Mainnet safety boundary

- The enabled product is only the standard Arc Mainnet ↔ Base Mainnet CCTP V2 bridge.
- Do not add a testnet runtime switch.
- Do not enable relay, gasless, refuel, or yield through configuration flags.
- Do not copy addresses from testnet deployment manifests into mainnet code.
- Never commit private keys, API keys, wallet seed phrases, or populated `.env` files.
- Do not introduce application fees without an explicit product and security review.

Changes that enable deferred capabilities require a separate design, threat
model, independent review, test plan, deployment manifest, and operational plan.

## Setup

```bash
git clone https://github.com/osr21/arc-relay-bridge.git
cd arc-relay-bridge
pnpm install
pnpm --filter @workspace/arc-bridge run dev
```

No secret is required to run or test the standard frontend bridge.

## Required checks

```bash
pnpm --filter @workspace/arc-bridge run typecheck
pnpm --filter @workspace/scripts exec tsx --test \
  ../artifacts/arc-bridge/src/lib/bridge.mainnet.test.ts
pnpm --filter @workspace/arc-bridge run build
```

Never run deployment, funding, or live-transfer scripts as part of a pull
request check. Mainnet canaries must be separately authorized and use a
deliberately limited amount.

## Good contributions

- Receipt, attestation, replay, and session-recovery reliability
- Wallet and RPC compatibility improvements
- Mainnet CCTP message validation and adversarial tests
- Accessibility and clear irreversible-action warnings
- Documentation corrections backed by official sources
- Additional Circle-supported mainnet routes, provided they fail closed and are
  separately validated in both directions

## Bug reports

Include:

1. Source and destination networks
2. Failed stage: Approve, Burn, Attest, or Mint
3. Whether a transaction hash was displayed
4. Public transaction hash, if safe to share
5. Wallet and browser versions
6. Exact error text with addresses and personal information redacted

If a burn hash exists, do not repeat the transfer until its receipt and CCTP
nonce have been reconciled.

## Pull requests

- Keep changes focused.
- Add or update tests for changed bridge invariants.
- Update documentation when behavior or supported networks change.
- State whether the change can cause a second burn, incorrect recipient, wrong
  domain, replay, or unexpected fee.
- Do not claim a change is audited unless an independent audit report is linked.

By contributing, you agree that your contribution is licensed under Apache-2.0.