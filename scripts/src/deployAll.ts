/**
 * Deploy all 4 hardened contracts (Paymaster, GasRelayer, FeeRouter, YieldVault)
 * to all 4 chains simultaneously. Contracts deploy sequentially per chain to avoid
 * nonce conflicts. Different chains have independent nonces, so they run in parallel.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run deploy-all
 *
 * Writes results to artifacts/arc-bridge/src/contracts/allDeployments.json
 */

import { ethers } from "ethers";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const ABI_DIR = resolve(ROOT, "contracts/abis");
const OUT_DIR = resolve(ROOT, "artifacts/arc-bridge/src/contracts");

// Read pre-compiled bytecodes from ABI JSON files
function readBytecode(name: string): string {
  const j = JSON.parse(readFileSync(`${ABI_DIR}/${name}.json`, "utf8"));
  if (!j.bytecode || j.bytecode.length < 10) throw new Error(`Missing bytecode in ${name}.json`);
  return j.bytecode;
}

const BYTECODES = {
  Paymaster:  readBytecode("Paymaster"),
  GasRelayer: readBytecode("GasRelayer"),
  FeeRouter:  readBytecode("FeeRouter"),
  YieldVault: readBytecode("YieldVault"),
};

const ENTRY_POINT = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";
const TOKEN_MESSENGER    = "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA";
const MESSAGE_TRANSMITTER = "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275";
const INITIAL_EP_DEPOSIT = ethers.parseEther("0.05");
const GAS_RATE   = 2n;
const RELAY_FEE  = 1_000_000n;
const FEE_BPS    = 30;

interface ChainConfig {
  name: string;
  chainId: number;
  rpcUrl: string;
  explorerUrl: string;
  usdc: string;
  apyBps: number;
  vaultLabel: string;
  paymasterGasLimit?: number;
}

const CHAINS: ChainConfig[] = [
  {
    name: "Arc Testnet",
    chainId: 5042002,
    rpcUrl: "https://rpc.drpc.testnet.arc.network",
    explorerUrl: "https://testnet.arcscan.app",
    usdc: "0x3600000000000000000000000000000000000000",
    apyBps: 1850,
    vaultLabel: "Arc Yield Vault",
    paymasterGasLimit: 3_000_000,
  },
  {
    name: "Ethereum Sepolia",
    chainId: 11155111,
    rpcUrl: "https://ethereum-sepolia-rpc.publicnode.com",
    explorerUrl: "https://sepolia.etherscan.io",
    usdc: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    apyBps: 780,
    vaultLabel: "Sepolia Yield Vault",
    // no paymasterGasLimit — let ethers estimate for Sepolia
  },
  {
    name: "Base Sepolia",
    chainId: 84532,
    rpcUrl: "https://sepolia.base.org",
    explorerUrl: "https://sepolia.basescan.org",
    usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    apyBps: 1230,
    vaultLabel: "Base Yield Vault",
    paymasterGasLimit: 3_000_000,
  },
  {
    name: "Avalanche Fuji",
    chainId: 43113,
    rpcUrl: "https://api.avax-test.network/ext/bc/C/rpc",
    explorerUrl: "https://testnet.snowtrace.io",
    usdc: "0x5425890298aed601595a70AB815c96711a31Bc65",
    apyBps: 920,
    vaultLabel: "Fuji Yield Vault",
    paymasterGasLimit: 3_000_000,
  },
];

interface ChainResult {
  chainId: number;
  name: string;
  paymaster:  string | null;
  gasRelayer: string | null;
  feeRouter:  string | null;
  yieldVault: string | null;
  errors: string[];
}

async function deployChain(
  chain: ChainConfig,
  privateKey: string,
  feeRecipient: string
): Promise<ChainResult> {
  const result: ChainResult = {
    chainId: chain.chainId,
    name: chain.name,
    paymaster: null,
    gasRelayer: null,
    feeRouter: null,
    yieldVault: null,
    errors: [],
  };

  const log = (msg: string) => console.log(`  [${chain.name}] ${msg}`);

  try {
    const provider = new ethers.JsonRpcProvider(chain.rpcUrl);
    const wallet   = new ethers.Wallet(privateKey, provider);
    const deployer = await wallet.getAddress();
    const balance  = await provider.getBalance(deployer);
    const network  = await provider.getNetwork();

    if (Number(network.chainId) !== chain.chainId) {
      throw new Error(`ChainId mismatch: expected ${chain.chainId}, got ${network.chainId}`);
    }
    log(`Deployer ${deployer}  balance ${ethers.formatEther(balance)} native`);
    if (balance === 0n) throw new Error(`No native balance — fund wallet first`);

    const deploy = async (
      name: string,
      abi: string[],
      bytecode: string,
      args: unknown[],
      gasLimit?: number
    ): Promise<string> => {
      log(`Deploying ${name}…`);
      const factory = new ethers.ContractFactory(abi, bytecode, wallet);
      const overrides = gasLimit ? { gasLimit } : {};
      const c = await factory.deploy(...args, overrides);
      const d = await c.waitForDeployment();
      const addr = await d.getAddress();
      log(`✅ ${name}: ${addr}`);
      return addr;
    };

    // 1. Paymaster
    try {
      const addr = await deploy(
        "Paymaster",
        ["constructor(address _usdc, address _relayer, address _feeRecipient, uint256 _gasRate)"],
        BYTECODES.Paymaster,
        [chain.usdc, deployer, feeRecipient, GAS_RATE],
        chain.paymasterGasLimit
      );
      result.paymaster = addr;

      // Fund EntryPoint for this Paymaster
      const bal = await provider.getBalance(deployer);
      if (bal >= INITIAL_EP_DEPOSIT) {
        log(`Funding EntryPoint for Paymaster…`);
        const ep = new ethers.Contract(
          ENTRY_POINT,
          ["function depositTo(address account) payable"],
          wallet
        );
        const tx = await ep.depositTo(addr, { value: INITIAL_EP_DEPOSIT });
        await tx.wait();
        log(`✅ EntryPoint funded`);
      } else {
        log(`⚠️  Skipped EntryPoint deposit (insufficient balance)`);
      }
    } catch (e) {
      const msg = `Paymaster failed: ${(e as Error).message}`;
      log(`❌ ${msg}`);
      result.errors.push(msg);
    }

    // 2. GasRelayer
    try {
      result.gasRelayer = await deploy(
        "GasRelayer",
        ["constructor(address _usdc, address _messageTransmitter, address _feeRecipient, uint256 _relayFee)"],
        BYTECODES.GasRelayer,
        [chain.usdc, MESSAGE_TRANSMITTER, feeRecipient, RELAY_FEE]
      );
    } catch (e) {
      const msg = `GasRelayer failed: ${(e as Error).message}`;
      log(`❌ ${msg}`);
      result.errors.push(msg);
    }

    // 3. FeeRouter
    try {
      result.feeRouter = await deploy(
        "FeeRouter",
        ["constructor(address _feeRecipient, uint256 _feeBps, address _usdc, address _tokenMessenger)"],
        BYTECODES.FeeRouter,
        [feeRecipient, FEE_BPS, chain.usdc, TOKEN_MESSENGER]
      );
    } catch (e) {
      const msg = `FeeRouter failed: ${(e as Error).message}`;
      log(`❌ ${msg}`);
      result.errors.push(msg);
    }

    // 4. YieldVault
    try {
      result.yieldVault = await deploy(
        "YieldVault",
        ["constructor(address _usdc, uint256 _apyBps, string _vaultName)"],
        BYTECODES.YieldVault,
        [chain.usdc, chain.apyBps, chain.vaultLabel]
      );
    } catch (e) {
      const msg = `YieldVault failed: ${(e as Error).message}`;
      log(`❌ ${msg}`);
      result.errors.push(msg);
    }
  } catch (e) {
    const msg = `Chain setup failed: ${(e as Error).message}`;
    console.log(`  [${chain.name}] ❌ ${msg}`);
    result.errors.push(msg);
  }

  return result;
}

async function main() {
  const privateKey   = process.env.DEPLOYER_PRIVATE_KEY;
  const feeRecipient = process.env.FEE_RECIPIENT;

  if (!privateKey)   throw new Error("DEPLOYER_PRIVATE_KEY not set");
  if (!feeRecipient) throw new Error("FEE_RECIPIENT not set");
  if (!ethers.isAddress(feeRecipient)) throw new Error(`FEE_RECIPIENT invalid: ${feeRecipient}`);

  console.log("🚀 Deploying all 4 contracts to all 4 chains (chains in parallel)");
  console.log(`   Fee recipient : ${feeRecipient}`);
  console.log(`   Fee rate      : ${FEE_BPS} bps`);
  console.log(`   Gas rate      : ${GAS_RATE} USDC-units/gas`);
  console.log(`   Relay fee     : ${ethers.formatUnits(RELAY_FEE, 6)} USDC`);
  console.log("═".repeat(60));

  // Parse optional --only flag: --only sepolia,fuji
  const onlyIdx = process.argv.indexOf("--only");
  const onlyFilter = onlyIdx !== -1
    ? process.argv[onlyIdx + 1].toLowerCase().split(",").map((s) => s.trim())
    : null;
  const chainsToRun = onlyFilter
    ? CHAINS.filter((c) => onlyFilter.some((f) => c.name.toLowerCase().includes(f)))
    : CHAINS;
  if (onlyFilter) console.log(`   Chains filter : ${chainsToRun.map((c) => c.name).join(", ")}`);

  // Run all chains in parallel — each chain has independent nonces.
  // Write results incrementally so a timeout doesn't lose completed chains.
  mkdirSync(OUT_DIR, { recursive: true });
  const outFile = resolve(OUT_DIR, "allDeployments.json");
  const partialResults: ChainResult[] = [];

  const savePartial = (r: ChainResult) => {
    partialResults.push(r);
    writeFileSync(outFile, JSON.stringify({
      deployedAt: new Date().toISOString(),
      partial: true,
      results: partialResults,
    }, null, 2));
    console.log(`  [${r.name}] 💾 Saved to allDeployments.json`);
  };

  const results = await Promise.all(
    chainsToRun.map(async (c) => {
      const r = await deployChain(c, privateKey, feeRecipient);
      savePartial(r);
      return r;
    })
  );

  console.log("\n" + "═".repeat(60));
  console.log("📄 Deployment Summary");
  for (const r of results) {
    console.log(`\n${r.name} (chainId ${r.chainId})`);
    console.log(`  Paymaster  : ${r.paymaster  ?? "❌ FAILED"}`);
    console.log(`  GasRelayer : ${r.gasRelayer ?? "❌ FAILED"}`);
    console.log(`  FeeRouter  : ${r.feeRouter  ?? "❌ FAILED"}`);
    console.log(`  YieldVault : ${r.yieldVault ?? "❌ FAILED"}`);
    if (r.errors.length) r.errors.forEach((e) => console.log(`  ⚠️  ${e}`));
  }

  // Final write — mark as complete (not partial)
  writeFileSync(outFile, JSON.stringify({ deployedAt: new Date().toISOString(), partial: false, results }, null, 2));
  console.log(`\n✅ Saved to: ${outFile}`);

  const anyFailed = results.some((r) => r.errors.length > 0);
  if (anyFailed) process.exit(1);
}

main().catch((e) => {
  console.error("💥 Fatal:", e.message);
  process.exit(1);
});
