/**
 * Local adversarial tests for GasRelayerV2.
 *
 * These tests deliberately use a minimal mock MessageTransmitter. The mock
 * only models destinationCaller and replay behavior; it does NOT validate
 * Circle attestations and must never be used as evidence about the deployed
 * Circle MessageTransmitter. Production authentication is performed by the
 * immutable Circle MessageTransmitter passed to GasRelayerV2 at deployment.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ganache from "ganache";
import {
  AbiCoder,
  BrowserProvider,
  Contract,
  ContractFactory,
  type InterfaceAbi,
  ZeroAddress,
  concat,
  hexlify,
  solidityPacked,
  zeroPadValue,
} from "ethers";
import solc from "solc";

const __dirname = dirname(fileURLToPath(import.meta.url));
const relaySource = readFileSync(resolve(__dirname, "../../contracts/GasRelayerV2.sol"), "utf8");

const mocksSource = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IRelayTarget {
    function relay(bytes calldata, bytes calldata, address, uint256) external;
}

contract MockUSDC {
    mapping(address => uint256) public balanceOf;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "MockUSDC: insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

/// @dev Local test double only. It does not implement Iris attestation checks.
contract MockMessageTransmitter {
    MockUSDC public immutable usdc;
    mapping(bytes32 => bool) public used;
    uint256 public mintAmount;
    address public callbackTarget;
    bytes public callbackData;
    bool public callbackBlocked;

    constructor(address _usdc) {
        usdc = MockUSDC(_usdc);
    }

    function setMintAmount(uint256 amount) external {
        mintAmount = amount;
    }

    function setCallback(address target, bytes calldata data) external {
        callbackTarget = target;
        callbackData = data;
        callbackBlocked = false;
    }

    function clearCallback() external {
        callbackTarget = address(0);
        delete callbackData;
    }

    function receiveMessage(bytes calldata message, bytes calldata) external returns (bool) {
        require(message.length == 440, "MockMT: malformed");
        bytes32 allowedCaller;
        assembly {
            allowedCaller := calldataload(add(message.offset, 108))
        }
        require(allowedCaller == bytes32(uint256(uint160(msg.sender))), "MockMT: destination caller");

        bytes32 messageHash = keccak256(message);
        require(!used[messageHash], "MockMT: duplicate");

        if (callbackTarget != address(0)) {
            (bool ok,) = callbackTarget.call(callbackData);
            callbackBlocked = !ok;
            require(!ok, "MockMT: callback unexpectedly succeeded");
        }

        used[messageHash] = true;
        usdc.mint(msg.sender, mintAmount);
        return true;
    }
}`;

interface Artifact {
  abi: InterfaceAbi;
  bytecode: string;
}

function compile(): Record<string, Artifact> {
  const input = {
    language: "Solidity",
    sources: {
      "GasRelayerV2.sol": { content: relaySource },
      "Mocks.sol": { content: mocksSource },
    },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
    },
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input))) as {
    errors?: Array<{ severity: string; formattedMessage: string }>;
    contracts?: Record<string, Record<string, { abi: unknown; evm: { bytecode: { object: string } } }>>;
  };
  const errors = output.errors?.filter((item) => item.severity === "error") ?? [];
  if (errors.length > 0 || !output.contracts) {
    throw new Error(errors.map((item) => item.formattedMessage).join("\n"));
  }

  const artifact = (file: string, name: string): Artifact => {
    const contract = output.contracts?.[file]?.[name];
    if (!contract) throw new Error(`Missing compiled artifact: ${name}`);
    return { abi: contract.abi as InterfaceAbi, bytecode: `0x${contract.evm.bytecode.object}` };
  };
  return {
    relay: artifact("GasRelayerV2.sol", "GasRelayerV2"),
    usdc: artifact("Mocks.sol", "MockUSDC"),
    transmitter: artifact("Mocks.sol", "MockMessageTransmitter"),
  };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

async function expectRevert(action: () => Promise<unknown>, expected: string): Promise<void> {
  try {
    const result = await action() as { wait?: () => Promise<unknown> } | undefined;
    if (result?.wait) await result.wait();
  } catch (error) {
    const rpcError = error as {
      shortMessage?: string;
      info?: { error?: { message?: string } };
    };
    const text = [String(error), rpcError.shortMessage, rpcError.info?.error?.message]
      .filter(Boolean)
      .join(" ");
    assert(text.includes(expected), `expected "${expected}", received "${text}"`);
    return;
  }
  throw new Error(`Expected revert containing "${expected}"`);
}

function addressWord(address: string): string {
  return zeroPadValue(address, 32);
}

/**
 * Independently constructs the official packed CCTP V2 offsets:
 * header 148; BurnMessageV2 fixed part 228; hook starts at byte 376.
 */
function makeV2Message(args: {
  relay: string;
  hookRecipient: string;
  hookMaxFee: bigint;
  headerVersion?: number;
  bodyVersion?: number;
  destinationCaller?: string;
  mintRecipient?: string;
  amount?: bigint;
  nonce?: string;
}): string {
  const zero32 = `0x${"00".repeat(32)}`;
  const header = solidityPacked(
    ["uint32", "uint32", "uint32", "bytes32", "bytes32", "bytes32", "bytes32", "uint32", "uint32"],
    [
      args.headerVersion ?? 1,
      0,
      0,
      args.nonce ?? `0x${"11".repeat(32)}`,
      zero32,
      zero32,
      addressWord(args.destinationCaller ?? args.relay),
      1_000,
      1_000,
    ],
  );
  const burnBody = solidityPacked(
    ["uint32", "bytes32", "bytes32", "uint256", "bytes32", "uint256", "uint256", "uint256"],
    [
      args.bodyVersion ?? 1,
      zero32,
      addressWord(args.mintRecipient ?? args.relay),
      args.amount ?? 5_000_000n,
      zero32,
      0n,
      0n,
      0n,
    ],
  );
  const hook = AbiCoder.defaultAbiCoder().encode(
    ["address", "uint256"],
    [args.hookRecipient, args.hookMaxFee],
  );
  const message = hexlify(concat([header, burnBody, hook]));
  assert((message.length - 2) / 2 === 440, "CCTP V2 message must be exactly 440 bytes");
  return message;
}

async function main(): Promise<void> {
  const artifacts = compile();
  // Local blocks mine synchronously; disable ethers' short RPC cache so replay
  // checks cannot reuse the successful pre-state estimate of the prior call.
  const provider = new BrowserProvider(
    ganache.provider({ logging: { quiet: true } }),
    undefined,
    { cacheTimeout: -1 },
  );
  const owner = await provider.getSigner(0);
  const feeRecipient = await provider.getSigner(1);
  const recipient = await provider.getSigner(2);
  const other = await provider.getSigner(3);

  const deploy = async (artifact: Artifact, ...args: unknown[]): Promise<Contract> => {
    const contract = await new ContractFactory(artifact.abi, artifact.bytecode, owner).deploy(...args);
    await contract.waitForDeployment();
    return contract;
  };

  const usdc = await deploy(artifacts.usdc);
  const transmitter = await deploy(artifacts.transmitter, await usdc.getAddress());
  const fee = 1_000_000n;
  const relayer = await deploy(
    artifacts.relay,
    await usdc.getAddress(),
    await transmitter.getAddress(),
    await feeRecipient.getAddress(),
    fee,
  );
  const relayAddress = await relayer.getAddress();
  const recipientAddress = await recipient.getAddress();
  const otherAddress = await other.getAddress();

  // Deploy-time configuration checks and version marker.
  await expectRevert(
    async () => new ContractFactory(artifacts.relay.abi, artifacts.relay.bytecode, owner).deploy(
      ZeroAddress, await transmitter.getAddress(), await feeRecipient.getAddress(), fee,
    ),
    "GasRelayerV2: zero usdc",
  );
  await expectRevert(
    async () => new ContractFactory(artifacts.relay.abi, artifacts.relay.bytecode, owner).deploy(
      await usdc.getAddress(), otherAddress, await feeRecipient.getAddress(), fee,
    ),
    "GasRelayerV2: transmitter has no code",
  );
  assert(
    await relayer.protocolVersion() === "gas-relayer-v2/cctp-v2-hook-v1",
    "protocol marker",
  );

  const valid = makeV2Message({
    relay: relayAddress,
    hookRecipient: recipientAddress,
    hookMaxFee: 2_000_000n,
  });
  await (await transmitter.setMintAmount(5_000_000n)).wait();

  // The external recipient exploit is closed: caller arguments must equal the
  // source-chain hook, before the transmitter is called.
  await expectRevert(
    () => relayer.relay(valid, "0x1234", otherAddress, 2_000_000n),
    "GasRelayerV2: recipient does not match hook",
  );
  await expectRevert(
    () => relayer.relay(valid, "0x1234", recipientAddress, 1_999_999n),
    "GasRelayerV2: maxFee does not match hook",
  );

  // Strict format, both CCTP V2 versions, and each independently documented offset.
  await expectRevert(
    () => relayer.relay(`${valid.slice(0, -2)}`, "0x", recipientAddress, 2_000_000n),
    "GasRelayerV2: invalid message length",
  );
  await expectRevert(
    () => relayer.relay(
      makeV2Message({ relay: relayAddress, hookRecipient: recipientAddress, hookMaxFee: 2_000_000n, headerVersion: 2 }),
      "0x", recipientAddress, 2_000_000n,
    ),
    "GasRelayerV2: invalid message version",
  );
  await expectRevert(
    () => relayer.relay(
      makeV2Message({ relay: relayAddress, hookRecipient: recipientAddress, hookMaxFee: 2_000_000n, bodyVersion: 2 }),
      "0x", recipientAddress, 2_000_000n,
    ),
    "GasRelayerV2: invalid burn version",
  );
  await expectRevert(
    () => relayer.relay(
      makeV2Message({ relay: relayAddress, hookRecipient: recipientAddress, hookMaxFee: 2_000_000n, destinationCaller: otherAddress }),
      "0x", recipientAddress, 2_000_000n,
    ),
    "GasRelayerV2: invalid destination caller",
  );
  await expectRevert(
    () => relayer.relay(
      makeV2Message({ relay: relayAddress, hookRecipient: recipientAddress, hookMaxFee: 2_000_000n, mintRecipient: otherAddress }),
      "0x", recipientAddress, 2_000_000n,
    ),
    "GasRelayerV2: invalid mint recipient",
  );
  await expectRevert(
    () => relayer.relay(
      makeV2Message({ relay: relayAddress, hookRecipient: ZeroAddress, hookMaxFee: 2_000_000n }),
      "0x", ZeroAddress, 2_000_000n,
    ),
    "GasRelayerV2: zero recipient",
  );

  // A direct external receiveMessage is restricted by destinationCaller.
  // This mock check is not a substitute for Circle's attestation verification.
  await expectRevert(
    () => transmitter.receiveMessage(valid, "0x"),
    "MockMT: destination caller",
  );

  // Correct payout and protocol replay rejection.
  await (await relayer.relay(valid, "0x1234", recipientAddress, 2_000_000n)).wait();
  assert((await usdc.balanceOf(recipientAddress)) === 4_000_000n, "recipient receives net amount");
  assert((await usdc.balanceOf(await feeRecipient.getAddress())) === fee, "fee recipient receives fee");
  await expectRevert(
    () => relayer.relay.staticCall(valid, "0x1234", recipientAddress, 2_000_000n),
    "MockMT: duplicate",
  );

  // Fee policy and gross amount protections.
  await expectRevert(() => relayer.setRelayFee(5_000_001n), "GasRelayerV2: fee too high");
  const lowerMaxFee = makeV2Message({
    relay: relayAddress, hookRecipient: recipientAddress, hookMaxFee: fee - 1n, nonce: `0x${"22".repeat(32)}`,
  });
  await expectRevert(
    () => relayer.relay(lowerMaxFee, "0x", recipientAddress, fee - 1n),
    "GasRelayerV2: fee exceeds maxFee",
  );
  await (await transmitter.setMintAmount(fee)).wait();
  const feeOnly = makeV2Message({
    relay: relayAddress, hookRecipient: recipientAddress, hookMaxFee: fee, amount: fee, nonce: `0x${"33".repeat(32)}`,
  });
  await expectRevert(
    () => relayer.relay(feeOnly, "0x", recipientAddress, fee),
    "GasRelayerV2: amount too small to cover fee",
  );
  await (await transmitter.setMintAmount(5_000_000n)).wait();

  // Reentry from a malicious transmitter callback is blocked before it can use
  // a message or affect the outer relay.
  const reentry = makeV2Message({
    relay: relayAddress, hookRecipient: recipientAddress, hookMaxFee: 2_000_000n, nonce: `0x${"44".repeat(32)}`,
  });
  const callback = relayer.interface.encodeFunctionData("relay", [
    reentry, "0x", recipientAddress, 2_000_000n,
  ]);
  await (await transmitter.setCallback(relayAddress, callback)).wait();
  await (await relayer.relay(reentry, "0x", recipientAddress, 2_000_000n)).wait();
  assert(await transmitter.callbackBlocked(), "reentrant callback must be blocked");
  await (await transmitter.clearCallback()).wait();

  await (await relayer.pause()).wait();
  const pausedMessage = makeV2Message({
    relay: relayAddress, hookRecipient: recipientAddress, hookMaxFee: 2_000_000n, nonce: `0x${"55".repeat(32)}`,
  });
  await expectRevert(
    () => relayer.relay(pausedMessage, "0x", recipientAddress, 2_000_000n),
    "GasRelayerV2: paused",
  );
  await (await relayer.unpause()).wait();
  await expectRevert(
    async () => relayer.rescueTokens(await usdc.getAddress(), recipientAddress, 1n),
    "GasRelayerV2: cannot rescue USDC",
  );

  console.log("GasRelayerV2 adversarial tests: PASS (13 security assertions/groups)");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});