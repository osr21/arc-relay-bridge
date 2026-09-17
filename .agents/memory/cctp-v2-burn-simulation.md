---
name: CCTP V2 burn simulation
description: Arc mainnet TokenMessenger preflight behavior with empty return data
---

Simulate CCTP V2 `depositForBurn` with a populated transaction and raw
`eth_call`, not an ABI-decoded contract `staticCall`.

**Why:** Arc mainnet's live TokenMessenger can execute a successful read-only
call while returning `0x`, despite the published ABI declaring a return value.
Ethers then reports `BAD_DATA` while decoding, which makes a valid preflight look
inconclusive. Raw `eth_call` still fails on EVM reverts but accepts empty success
data.

**How to apply:** Populate the exact seven-argument burn request, set the
connected signer as `from`, and send it through the source RPC provider's raw
call before submitting the real transaction.