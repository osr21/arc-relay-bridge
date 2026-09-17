/**
 * Read-only mainnet preflight.
 *
 * This command deliberately accepts an address, rather than a private key or
 * an environment variable.  It only performs RPC reads and eth_estimateGas;
 * it never creates a signer or sends a transaction.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run mainnet-preflight -- \
 *     --deployer 0x... [--output docs/mainnet-preflight.json]
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { ethers } from "ethers";
// solc does not publish TypeScript declarations.
// @ts-ignore
import solc from "solc";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../..");
const RPC_TIMEOUT_MS = 15_000;

const TOKEN_MESSENGER = "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d";
const MESSAGE_TRANSMITTER = "0x81D40F21F12A8F0E3252Bccb954D722d4c464B64";
const ENTRY_POINT_V07 = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";
const RELAY_FEE = 1_000_000n;
const GAS_RATE = 2n;
const FEE_BPS = 30n;

type CheckStatus = "ok" | "failed" | "skipped";

interface CheckResult {
  name: string;
  status: CheckStatus;
  details?: Record<string, unknown>;
  error?: string;
}

interface ChainTarget {
  name: string;
  chainId: number;
  domain: number;
  rpcUrl: string;
  usdc: string;
}

interface CompiledContract {
  name: string;
  source: string;
  abi: ethers.InterfaceAbi;
  bytecode: string;
}

interface ContractSpec {
  name: string;
  file: string;
  constructorArgs: (chain: ChainTarget, deployer: string) => readonly unknown[];
}

const CHAINS: ChainTarget[] = [
  {
    name: "Arc Mainnet",
    chainId: 5042,
    domain: 26,
    rpcUrl: "https://rpc.mainnet.arc.io",
    usdc: "0x3600000000000000000000000000000000000000",
  },
  {
    name: "Base Mainnet",
    chainId: 8453,
    domain: 6,
    rpcUrl: "https://mainnet.base.org",
    usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  },
];

const CONTRACTS: ContractSpec[] = [
  {
    name: "GasRelayerV2",
    file: "GasRelayerV2.sol",
    constructorArgs: (chain, deployer) => [
      chain.usdc,
      MESSAGE_TRANSMITTER,
      deployer,
      RELAY_FEE,
    ],
  },
  {
    name: "Paymaster",
    file: "Paymaster.sol",
    constructorArgs: (chain, deployer) => [
      chain.usdc,
      deployer,
      deployer,
      GAS_RATE,
    ],
  },
  {
    name: "FeeRouter",
    file: "FeeRouter.sol",
    constructorArgs: (chain, deployer) => [
      deployer,
      FEE_BPS,
      chain.usdc,
      TOKEN_MESSENGER,
    ],
  },
];

const ERC20_ABI = [
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function balanceOf(address account) view returns (uint256)",
];
const MESSAGE_TRANSMITTER_ABI = ["function localDomain() view returns (uint32)"];

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

async function withTimeout<T>(
  operation: Promise<T>,
  label: string,
  timeoutMs = RPC_TIMEOUT_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function runCheck(
  name: string,
  operation: () => Promise<Record<string, unknown> | undefined>,
): Promise<CheckResult> {
  try {
    return { name, status: "ok", details: await operation() };
  } catch (error) {
    // Failures are kept with the individual check. This makes an unavailable
    // RPC visible without preventing checks on the other chain from running.
    return { name, status: "failed", error: errorMessage(error) };
  }
}

function skippedCheck(name: string, reason: string): CheckResult {
  return { name, status: "skipped", error: reason };
}

function compileContract(spec: ContractSpec): CompiledContract {
  const sourcePath = resolve(REPO_ROOT, "contracts", spec.file);
  const source = readFileSync(sourcePath, "utf8");
  const input = {
    language: "Solidity",
    sources: { [spec.file]: { content: source } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "paris",
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
    },
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input))) as {
    errors?: Array<{ severity?: string; formattedMessage?: string; message?: string }>;
    contracts?: Record<string, Record<string, { abi: unknown; evm?: { bytecode?: { object?: string } } }>>;
  };
  const compilerErrors = (output.errors ?? []).filter((entry) => entry.severity === "error");
  if (compilerErrors.length > 0) {
    throw new Error(compilerErrors.map((entry) => entry.formattedMessage ?? entry.message ?? "solc error").join("\n"));
  }
  const contract = output.contracts?.[spec.file]?.[spec.name];
  const bytecode = contract?.evm?.bytecode?.object;
  if (!contract || !bytecode) {
    throw new Error(`solc produced no bytecode for ${spec.name}`);
  }
  return {
    name: spec.name,
    source: `contracts/${spec.file}`,
    abi: contract.abi as ethers.InterfaceAbi,
    bytecode: `0x${bytecode}`,
  };
}

function formatUsdc(value: bigint, decimals: number): string {
  try {
    return ethers.formatUnits(value, decimals);
  } catch {
    return value.toString();
  }
}

async function estimateDeployment(
  provider: ethers.JsonRpcProvider,
  chain: ChainTarget,
  deployer: string,
  compiled: CompiledContract,
  gasPrice: bigint | null,
): Promise<Record<string, unknown>> {
  const factory = new ethers.ContractFactory(compiled.abi, compiled.bytecode);
  const deployTransaction = await withTimeout(
    factory.getDeployTransaction(...(CONTRACTS.find((spec) => spec.name === compiled.name)?.constructorArgs(chain, deployer) ?? [])),
    `${chain.name} ${compiled.name} getDeployTransaction`,
  );
  // `from` is the supplied public address only; no signer is constructed.
  const gas = await withTimeout(
    provider.estimateGas({ ...deployTransaction, from: deployer }),
    `${chain.name} ${compiled.name} eth_estimateGas`,
  );
  const details: Record<string, unknown> = {
    gasEstimate: gas.toString(),
    from: deployer,
    executionOnly: true,
  };
  if (gasPrice !== null) {
    details.gasPriceWei = gasPrice.toString();
    details.gasPriceGwei = ethers.formatUnits(gasPrice, "gwei");
    details.executionCostWei = (gas * gasPrice).toString();
    details.executionCostNative = ethers.formatEther(gas * gasPrice);
  } else {
    details.costUnavailableReason = "RPC did not return a gasPrice snapshot";
  }
  return details;
}

async function preflightChain(
  chain: ChainTarget,
  deployer: string,
  compiled: Map<string, CompiledContract>,
): Promise<Record<string, unknown>> {
  const provider = new ethers.JsonRpcProvider(chain.rpcUrl);
  const checks: CheckResult[] = [];

  // This check must happen before any pinned-address or pinned-domain call.
  const chainIdCheck = await runCheck("actual chainId", async () => {
    const network = await withTimeout(provider.getNetwork(), `${chain.name} chainId`);
    const actualChainId = Number(network.chainId);
    if (actualChainId !== chain.chainId) {
      throw new Error(`chain ID mismatch: expected ${chain.chainId}, got ${actualChainId}`);
    }
    return { expected: chain.chainId, actual: actualChainId };
  });
  checks.push(chainIdCheck);
  if (chainIdCheck.status !== "ok") {
    return {
      name: chain.name,
      chainId: chain.chainId,
      domain: chain.domain,
      rpcUrl: chain.rpcUrl,
      checks,
      gasEstimates: [],
    };
  }

  const messageTransmitter = new ethers.Contract(
    MESSAGE_TRANSMITTER,
    MESSAGE_TRANSMITTER_ABI,
    provider,
  );
  const usdc = new ethers.Contract(chain.usdc, ERC20_ABI, provider);

  checks.push(await runCheck("MessageTransmitter.localDomain", async () => {
    const localDomain = Number(await withTimeout(
      messageTransmitter.localDomain(),
      `${chain.name} MessageTransmitter.localDomain`,
    ));
    if (localDomain !== chain.domain) {
      throw new Error(`localDomain mismatch: expected ${chain.domain}, got ${localDomain}`);
    }
    return { expected: chain.domain, actual: localDomain, matches: localDomain === chain.domain };
  }));
  checks.push(await runCheck("USDC metadata", async () => {
    const [decimals, symbol] = await Promise.all([
      withTimeout(usdc.decimals(), `${chain.name} USDC decimals`),
      withTimeout(usdc.symbol(), `${chain.name} USDC symbol`),
    ]);
    if (Number(decimals) !== 6 || String(symbol) !== "USDC") {
      throw new Error(`unexpected USDC metadata: decimals=${decimals}, symbol=${String(symbol)}`);
    }
    return {
      expectedDecimals: 6,
      decimals: Number(decimals),
      expectedSymbol: "USDC",
      symbol: String(symbol),
      matches: Number(decimals) === 6 && String(symbol) === "USDC",
    };
  }));
  checks.push(await runCheck("deployer balances", async () => {
    const [native, usdcBalance] = await Promise.all([
      withTimeout(provider.getBalance(deployer), `${chain.name} native balance`),
      withTimeout(usdc.balanceOf(deployer), `${chain.name} USDC balance`),
    ]);
    return {
      deployer,
      nativeBalanceWei: native.toString(),
      nativeBalance: ethers.formatEther(native),
      usdcBalanceRaw: usdcBalance.toString(),
      usdcBalance: formatUsdc(usdcBalance, 6),
    };
  }));

  const codeTargets: Array<{ name: string; address: string; allowNoCode?: boolean }> = [
    { name: "TokenMessenger code", address: TOKEN_MESSENGER },
    { name: "MessageTransmitter code", address: MESSAGE_TRANSMITTER },
    { name: "EntryPoint v0.7 code", address: ENTRY_POINT_V07 },
    // Arc USDC is a documented system/precompile address and may report no
    // bytecode. Base USDC must have ordinary contract bytecode.
    { name: "USDC code", address: chain.usdc, allowNoCode: chain.name === "Arc Mainnet" },
  ];
  for (const target of codeTargets) {
    checks.push(await runCheck(target.name, async () => {
      const code = await withTimeout(provider.getCode(target.address), `${chain.name} ${target.name}`);
      const hasCode = code !== "0x" && code !== "0x0";
      if (!hasCode && !target.allowNoCode) {
        throw new Error(`no contract code at ${target.address}`);
      }
      return {
        address: target.address,
        hasCode,
        systemContractException: !hasCode && target.allowNoCode === true,
      };
    }));
  }

  const gasPriceCheck = await runCheck("gasPrice snapshot", async () => {
    const feeData = await withTimeout(provider.getFeeData(), `${chain.name} fee data`);
    if (feeData.gasPrice === null) {
      throw new Error("RPC returned no legacy gasPrice");
    }
    return {
      gasPriceWei: feeData.gasPrice.toString(),
      gasPriceGwei: ethers.formatUnits(feeData.gasPrice, "gwei"),
    };
  });
  checks.push(gasPriceCheck);
  const gasPrice = gasPriceCheck.status === "ok"
    ? BigInt(gasPriceCheck.details?.gasPriceWei as string)
    : null;

  const gasEstimates: Array<Record<string, unknown>> = [];
  for (const spec of CONTRACTS) {
    const artifact = compiled.get(spec.name);
    if (!artifact) {
      gasEstimates.push({ contract: spec.name, status: "failed", error: "compilation failed; estimate not attempted" });
      continue;
    }
    const estimate = await runCheck(`${spec.name} deployment estimate`, async () =>
      estimateDeployment(provider, chain, deployer, artifact, gasPrice),
    );
    gasEstimates.push({
      contract: spec.name,
      status: estimate.status,
      ...(estimate.details ?? {}),
      ...(estimate.error ? { error: estimate.error } : {}),
    });
  }

  return {
    name: chain.name,
    chainId: chain.chainId,
    domain: chain.domain,
    rpcUrl: chain.rpcUrl,
    checks,
    gasEstimates,
  };
}

function parseArgs(argv: string[]): { deployer: string; output?: string } {
  let deployer: string | undefined;
  let output: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--") continue;
    if (argument === "--deployer" || argument === "--output") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value`);
      if (argument === "--deployer") deployer = value;
      else output = value;
      index += 1;
    } else if (argument.startsWith("--deployer=")) {
      deployer = argument.slice("--deployer=".length);
    } else if (argument.startsWith("--output=")) {
      output = argument.slice("--output=".length);
    } else if (argument === "--help" || argument === "-h") {
      console.log("Usage: mainnet-preflight --deployer 0x... [--output report.json]");
      process.exit(0);
    } else {
      throw new Error(`unknown argument: ${argument}`);
    }
  }
  if (!deployer) throw new Error("--deployer public address is required");
  if (!ethers.isAddress(deployer)) throw new Error(`invalid --deployer address: ${deployer}`);
  return { deployer: ethers.getAddress(deployer), output };
}

async function main(): Promise<void> {
  const { deployer, output } = parseArgs(process.argv.slice(2));
  const compilation: CheckResult[] = [];
  const compiled = new Map<string, CompiledContract>();
  for (const spec of CONTRACTS) {
    const result = await runCheck(`compile ${spec.name}`, async () => {
      const artifact = compileContract(spec);
      compiled.set(spec.name, artifact);
      return {
        source: artifact.source,
        compiler: "solc 0.8.20",
        optimizerRuns: 200,
        evmVersion: "paris",
        bytecodeBytes: (artifact.bytecode.length - 2) / 2,
      };
    });
    compilation.push(result);
  }

  const chainReports: Record<string, unknown>[] = [];
  for (const chain of CHAINS) {
    try {
      chainReports.push(await preflightChain(chain, deployer, compiled));
    } catch (error) {
      // An unexpected chain-level error remains explicit and does not hide the
      // report for the other chain.
      chainReports.push({
        name: chain.name,
        chainId: chain.chainId,
        domain: chain.domain,
        rpcUrl: chain.rpcUrl,
        checks: [{ name: "chain execution", status: "failed", error: errorMessage(error) }],
        gasEstimates: [],
      });
    }
  }

  const report = {
    reportType: "read-only-mainnet-preflight",
    generatedAt: new Date().toISOString(),
    deployer,
    pinned: {
      cctpVersion: "V2",
      chains: CHAINS,
      tokenMessenger: TOKEN_MESSENGER,
      messageTransmitter: MESSAGE_TRANSMITTER,
      entryPointV07: ENTRY_POINT_V07,
    },
    compilation,
    chains: chainReports,
    launchReady: false,
    knownBlockers: [
      "GasRelayerV2 authenticated-payout source requires review, source-burn hook integration and verified deployment; never use the unbound legacy relay on mainnet.",
      "YieldVault simulated yields can consume other principal when the vault is not pre-funded with sufficient real USDC.",
      "Backend payout idempotency is not durable.",
      "Mainnet AA provider and contracts are unconfigured.",
    ],
    caveats: [
      "Constructor values in estimates are indicative placeholders only: feeRecipient=deployer, relayFee=1 USDC, gasRate=2, feeBps=30. YieldVault is excluded; yield is disabled.",
      "Deployment estimates use only eth_estimateGas with the supplied public deployer as from; they do not send transactions or confer safety.",
      "Execution-only gas cost is gasEstimate multiplied by the gasPrice snapshot. Base cost excludes L1/security/staking/liquidity costs.",
      "This report is not an audit and does not claim audited or deploy-ready status.",
    ],
  };

  const serialized = JSON.stringify(report, null, 2);
  if (output) {
    // Resolve reports from the repository root. pnpm package-filter commands
    // run with scripts/ as cwd, while direct invocations commonly run at root.
    const outputPath = output.startsWith("/")
      ? output
      : resolve(REPO_ROOT, output);
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${serialized}\n`, "utf8");
    console.error(`Wrote preflight report to ${outputPath}`);
  }
  console.log(serialized);
}

void main().catch((error: unknown) => {
  console.error(`mainnet-preflight failed: ${errorMessage(error)}`);
  process.exitCode = 1;
});
