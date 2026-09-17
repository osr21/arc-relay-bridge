# Security policy

## Supported scope

Security reports are accepted for the Arc Mainnet ↔ Base Mainnet standard CCTP
V2 bridge on the default branch. Relay, gasless, refuel, yield, deployment
scripts, and historical testnet contracts are not enabled mainnet products.

## Reporting

Do not publish an exploitable vulnerability or sensitive user information in a
public issue. Use GitHub's private vulnerability reporting feature for this
repository when available.

Include affected revision, route, transaction stage, impact, reproduction steps,
and a minimal proof of concept. Never include private keys, seed phrases, API
keys, session cookies, or unredacted personal information.

## Key assumptions

- Circle's official CCTP contracts and Iris attestations are trusted protocol dependencies.
- Chain RPC responses are independently reconciled with transaction receipts.
- Users review wallet prompts and control source and destination gas.
- Browser local storage is a recovery convenience, not a custody mechanism.
- A transaction hash is treated as evidence of broadcast until chain state proves otherwise.

## Mainnet warning

This repository has not received an independent security audit. Mainnet
transactions move real assets and are irreversible after source burn.