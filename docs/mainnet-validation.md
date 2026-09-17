# Arc ↔ Base mainnet validation

**Validated:** 17 September 2026  
**Scope:** Standard Circle CCTP V2 transfer, no application fee  
**Networks:** Arc Mainnet (`5042`, domain `26`) and Base Mainnet (`8453`, domain `6`)

## Successful round trip

A real `0.10 USDC` canary completed Arc → Base → Arc:

| Step | Transaction |
|---|---|
| Arc source burn | [0x987bf10c253fbbe4f47b7b25d36cff4bc0f534f01514aebaee78faf5034e31be](https://explorer.arc.io/tx/0x987bf10c253fbbe4f47b7b25d36cff4bc0f534f01514aebaee78faf5034e31be) |
| Base destination mint | [0x187802da8e2326eeabc93d1e8e013c7e8fcf6f74cc1bcf33e0a7ff05d3f36462](https://basescan.org/tx/0x187802da8e2326eeabc93d1e8e013c7e8fcf6f74cc1bcf33e0a7ff05d3f36462) |
| Base source burn | [0x2e488fdc6614a9fff0921dc02fd9c701290a6bb6b397ffdf14a1dc4cd825c19d](https://basescan.org/tx/0x2e488fdc6614a9fff0921dc02fd9c701290a6bb6b397ffdf14a1dc4cd825c19d) |
| Arc destination mint | [0x59cc578c955a3b7f32e9d985f2e3970d1b2a38d4d8dee4f6f435fd4ed4adbc23](https://explorer.arc.io/tx/0x59cc578c955a3b7f32e9d985f2e3970d1b2a38d4d8dee4f6f435fd4ed4adbc23) |

## Parameters validated

- Production Iris: `https://iris-api.circle.com`
- Seven-parameter CCTP V2 `depositForBurn`
- Finality threshold `2000`
- Fast-transfer maximum fee `0`
- Unrestricted destination caller
- Zero application fee
- Exact Arc and Base mainnet CCTP domains
- Real native USDC burn and mint in both directions

## Recovery behavior validated in code

- Save a resumable session immediately when a burn hash is available
- Re-fetch the authoritative source receipt on resume
- Poll a static chain RPC when the wallet RPC fails after broadcast
- Match source and Iris messages by immutable fields
- Reject absent or ambiguous message matches
- Check the attested nonce before minting
- Prevent a fresh transfer action while an unresolved burn exists

## Limitations

This validation is evidence that the stated transfer path completed with the
tested configuration. It is not a security audit, uptime guarantee, or approval
of relay, gasless, refuel, yield, or historical testnet contracts.

Public RPC and Iris availability can affect completion time. Once a source burn
is confirmed, funds complete through CCTP minting rather than by reversing the
burn. Users must retain the burn transaction hash and enough destination gas.