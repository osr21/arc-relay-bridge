---
name: Wallet RPC post-broadcast errors
description: Recover safely when a wallet RPC fails after returning a transaction hash
---

Treat wallet RPC `-32080`, HTTP 403, and “could not coalesce” errors as
potentially transient when a transaction hash has already been returned. Poll
the authoritative chain RPC for that hash instead of declaring the transaction
unsent.

**Why:** A Base wallet RPC returned a burn transaction hash, then failed while
waiting for its receipt with HTTP 403. The UI incorrectly said no burn was
submitted and offered a new transfer, creating a duplicate-burn risk.

**How to apply:** Once a burn hash exists, persist the bridge session immediately.
On wallet receipt errors, fall back to static source RPC receipt polling. Error
UI must offer resume/recovery and must not offer a fresh transfer until the
existing burn is resolved.