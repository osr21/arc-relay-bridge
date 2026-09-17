# Deferred-service mainnet preflight (read-only)

> The standard Arc Mainnet ↔ Base Mainnet CCTP V2 bridge is live and validated.
> This older diagnostic remains for evaluating the separately disabled relay,
> gasless, refuel, and contract-deployment work. It is not the readiness signal
> for the standard bridge. See [Mainnet validation](mainnet-validation.md).

Run the preflight from the repository root with an explicit public address:

```sh
pnpm --filter @workspace/scripts run mainnet-preflight -- \
  --deployer 0xdb5019b8DfbccEF8906C39B16a4870082eAbBc4C \
  --output docs/mainnet-preflight.json
```

The command does not read environment variables, secrets, private keys, or
deployment files. It does not construct a signer or send a transaction. It
checks the actual chain ID before using the pinned Arc Mainnet and Base Mainnet
addresses for CCTP V2, reads CCTP/USDC metadata and balances, checks contract code, and
performs bounded `eth_estimateGas` calls.

The Arc USDC system/precompile address is the one intentional no-bytecode
exception for the code check; TokenMessenger, MessageTransmitter,
EntryPoint v0.7, and Base USDC must expose code.

Each contract is compiled from the current Solidity source independently with
solc 0.8.20, optimizer 200 runs, and `evmVersion: paris`; checked-in or
generated deployment artifacts are not trusted. Estimate constructor values
are explicitly indicative placeholders: the supplied deployer is used as
`feeRecipient` and relayer, with relay fee `1 USDC`, gas rate `2`, fee `30`
basis points. Only GasRelayerV2, Paymaster and FeeRouter are estimated;
YieldVault is excluded because mainnet yield is disabled. An estimate failure is reported as a
failure; no gas number is inferred.

The historical report contains `launchReady: false` for the broader product
that included deferred services. It is a diagnostic snapshot, not an audit or
a deployment approval. Gas cost is shown as
`gasEstimate × gasPrice` for execution only. In particular, Base estimates
exclude L1/security/staking/liquidity costs. A successful estimate does not
establish contract safety.

Known blockers are retained in every report: GasRelayerV2 needs authenticated
source-burn integration and verified deployment (legacy GasRelayer is unsafe),
simulated YieldVault yields can consume other principal,
backend payout idempotency is not durable, and the mainnet AA provider and
contracts are unconfigured. Testnet application configuration is not changed
by this command.

## Release scope and outstanding decisions

The standard Arc Mainnet ↔ Base Mainnet bridge has since been activated and
validated with a real round trip. Relay, gasless transactions, refuel, and
yield remain disabled. No transactions are signed by this preflight.

Before enabling any deferred service:

1. Complete integration and review of the new relay payout recipient and accepted fee binding to authenticated transfer
   intent. A caller-supplied `recipient` is not authenticated simply because
   Circle attests to the accompanying CCTP message. Add adversarial tests
   for competing callers, modified recipients and direct minting.
2. Keep the simulated yield product disabled. The current
   vault caps withdrawal at its entire balance, not surplus above all user
   principal. For example, with two 100-USDC deposits and no reward funding,
   a 110-USDC first withdrawal leaves only 90 for the second depositor.
   Do not present configured APYs as investment returns. The real strategy
   or explicitly treasury-funded reward model needs a product decision.
3. Make relay/refuel payment processing durable and idempotent, with receipt
   reconciliation and recovery across restarts and concurrent requests.
4. Verify bundler support and the exact account/EntryPoint combination for
   each mainnet; code existing at an EntryPoint address is not a working AA
   integration. Pimlico's supported-chains page checked on 2026-09-17 lists
   Base Mainnet and Arc Testnet; Arc Mainnet support remains unconfirmed.
5. Keep testnet routes, sandbox Iris requests, and historical deployment
   manifests isolated from the mainnet runtime. Keep incomplete features
   inaccessible on mainnet.
6. Agree on owner/fee treasury, operational liquidity, sponsorship limits and
   deployment budget. Obtain independent contract/integration review, test
   recovery paths, and complete a small, explicitly authorized mainnet canary
   before enabling public use.

The constructor estimates in the JSON are for **current, unreleased source**
and placeholder constructor policies, not approval to deploy those contracts.
Repaired contracts must be recompiled and re-estimated. Setup calls, native
gas reserves, EntryPoint deposits/stakes, refuel liquidity, reward funding,
and Base L1 data fees are not included in the quoted execution costs.

### Official references

- [Arc network settings](https://docs.arc.io/arc/references/connect-to-arc)
- [Base network settings](https://docs.base.org/get-started/connect-to-base)
- [Circle CCTP addresses](https://developers.circle.com/cctp/references/contract-addresses)
- [Circle USDC addresses](https://developers.circle.com/stablecoins/usdc-contract-addresses)
- [Pimlico supported chains](https://docs.pimlico.io/guides/supported-chains)