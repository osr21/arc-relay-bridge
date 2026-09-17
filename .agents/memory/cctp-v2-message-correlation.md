---
name: CCTP V2 message correlation
description: Safely correlate source MessageSent payloads with Iris-attested V2 messages
---

CCTP V2 source `MessageSent` bytes are not byte-identical to the message Iris
later attests. Correlate them by immutable header and burn-body fields, require
exactly one match, and use the attested message's assigned nonce for replay state.

**Why:** The source payload contains placeholder zero values for the V2 nonce and
executed finality. Circle assigns execution fields before attestation, so comparing
full-message hashes prevents every valid transfer from completing. Conversely,
accepting the first Iris result can pair the wrong burn in a multi-message
transaction. `MessageTransmitterV2.usedNonces` is keyed by the assigned bytes32
nonce, not by a hash of the full message.

**How to apply:** Re-derive source messages from the successful burn receipt and
configured MessageTransmitter. Validate domains, sender/recipient contracts,
destination caller, finality request, burn token, mint recipient, amount,
message sender, and max fee. Allow only attester-controlled nonce/execution fields
to change; reject zero or multiple matching Iris messages.