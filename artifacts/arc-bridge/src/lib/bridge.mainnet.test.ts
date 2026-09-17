import assert from "node:assert/strict";
import test from "node:test";
import { ethers } from "ethers";
import { CHAINS } from "./chains";
import {
  ARC_MINT_GAS_RESERVE,
  BASE_MINT_GAS_RESERVE,
  decodeCctpMessage,
  friendlyError,
  hasArcMintGasReserve,
  hasBaseMintGasReserve,
  isMatchingAttestedMessage,
  selectUniqueAttestedMessage,
  validateCctpMessage,
} from "./bridge";

const source = CHAINS.ARC_MAINNET;
const destination = CHAINS.BASE_MAINNET;
const recipient = "0x1111111111111111111111111111111111111111";
const sender = "0x2222222222222222222222222222222222222222";
const amount = 1_250_000n;

function u32(value: number): string {
  return ethers.zeroPadValue(ethers.toBeHex(value), 4);
}

function word(value: string | bigint): string {
  return ethers.zeroPadValue(
    typeof value === "bigint" ? ethers.toBeHex(value) : value,
    32,
  );
}

function fixture(
  from = source,
  to = destination,
  nonce = ethers.ZeroHash,
  finalityExecuted = 0,
  feeExecuted = 0n,
  expirationBlock = 0n,
): string {
  return ethers.concat([
    u32(1),
    u32(from.cctpDomain),
    u32(to.cctpDomain),
    nonce,
    word(sender),
    word(to.tokenMessenger),
    ethers.ZeroHash,
    u32(2000),
    u32(finalityExecuted),
    u32(1),
    word(from.usdcAddress),
    word(recipient),
    word(amount),
    word(sender),
    word(0n),
    word(feeExecuted),
    word(expirationBlock),
  ]);
}

function replaceBytes(message: string, offset: number, value: string): string {
  const bytes = ethers.getBytes(message);
  bytes.set(ethers.getBytes(value), offset);
  return ethers.hexlify(bytes);
}

test("accepts the exact standard CCTP V2 Arc-to-Base layout", () => {
  const message = fixture();
  assert.equal(ethers.dataLength(message), 376);
  assert.doesNotThrow(() =>
    validateCctpMessage(message, source, destination, recipient, "1.25"),
  );
});

test("rejects shifted or substituted header and burn-body fields", () => {
  const message = fixture();
  assert.throws(
    () => validateCctpMessage(replaceBytes(message, 76, word(recipient)), source, destination, recipient, "1.25"),
    /destination TokenMessenger/,
  );
  assert.throws(
    () => validateCctpMessage(replaceBytes(message, 184, word(sender)), source, destination, recipient, "1.25"),
    /mint recipient/,
  );
  assert.throws(
    () => validateCctpMessage(replaceBytes(message, 216, word(1_249_999n)), source, destination, recipient, "1.25"),
    /burn amount/,
  );
  assert.throws(
    () => validateCctpMessage(replaceBytes(message, 108, word(sender)), source, destination, recipient, "1.25"),
    /destination caller/,
  );
  assert.throws(
    () => validateCctpMessage(`${message}00`, source, destination, recipient, "1.25"),
    /exactly 376 bytes/,
  );
});

for (const [label, from, to] of [
  ["Arc-to-Base", CHAINS.ARC_MAINNET, CHAINS.BASE_MAINNET],
  ["Base-to-Arc", CHAINS.BASE_MAINNET, CHAINS.ARC_MAINNET],
] as const) {
  test(`correlates source and attested mutations for ${label}`, () => {
    const sourceMessage = fixture(from, to);
    const attestedMessage = fixture(
      from,
      to,
      `0x${"12".repeat(32)}`,
      2000,
      0n,
      99_999n,
    );
    assert.equal(isMatchingAttestedMessage(sourceMessage, attestedMessage), true);
    assert.equal(
      selectUniqueAttestedMessage(sourceMessage, [attestedMessage]),
      attestedMessage,
    );
    assert.equal(decodeCctpMessage(attestedMessage).nonce, `0x${"12".repeat(32)}`);
  });
}

test("fails closed for invalid or ambiguous attested messages", () => {
  const sourceMessage = fixture();
  const attestedMessage = fixture(
    source,
    destination,
    `0x${"34".repeat(32)}`,
    2000,
  );
  assert.equal(isMatchingAttestedMessage(sourceMessage, fixture()), false);
  assert.equal(
    isMatchingAttestedMessage(
      sourceMessage,
      replaceBytes(attestedMessage, 280, word(1n)),
    ),
    false,
  );
  assert.throws(
    () => selectUniqueAttestedMessage(sourceMessage, [attestedMessage, attestedMessage]),
    /ambiguous/,
  );
});

test("enforces the Arc destination gas reserve boundary", () => {
  assert.equal(hasArcMintGasReserve(ARC_MINT_GAS_RESERVE - 1n), false);
  assert.equal(hasArcMintGasReserve(ARC_MINT_GAS_RESERVE), true);
});

test("enforces the Base destination gas reserve boundary", () => {
  assert.equal(hasBaseMintGasReserve(BASE_MINT_GAS_RESERVE - 1n), false);
  assert.equal(hasBaseMintGasReserve(BASE_MINT_GAS_RESERVE), true);
});

test("explains wallet RPC failures without claiming a submitted burn is absent", () => {
  const message = friendlyError(new Error(
    'could not coalesce error (error={ "code": -32080, "data": { "httpStatus": 403, "message": "RPC endpoint returned HTTP client error" } })',
  ));
  assert.match(message, /may already be submitted/);
  assert.doesNotMatch(message, /No bridge burn was submitted/);
});