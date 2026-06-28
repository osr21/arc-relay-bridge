/**
 * Fund Paymaster contracts at the EntryPoint.
 *
 * ERC-4337 requires each Paymaster to hold ETH at the EntryPoint to cover
 * UserOp gas costs.  Without this deposit every bundler simulation rejects
 * the UserOp — the Paymaster's in-contract USDC balances are irrelevant until
 * it has ETH at the EntryPoint.
 *
 * This script deposits ETH from the deployer wallet into the EntryPoint for
 * each deployed Paymaster.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run fund-paymaster
 *   pnpm --filter @workspace/scripts run fund-paymaster -- --amount 0.1
 *   pnpm --filter @workspace/scripts run fund-paymaster -- --only sepolia
 *   pnpm --filter @workspace/scripts run fund-paymaster -- --only sepolia,base
 *
 * Flags:
 *   --amount   ETH to deposit per chain (default: 0.05)
 *   --only     Comma-separated chain name fragments to target (case-insensitive)
 *
 * Reads from environment:
 *   DEPLOYER_PRIVATE_KEY — wallet that holds native gas on each chain
 */

import { ethers } from "ethers";

const ENTRY_POINT_V07 = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";

const ENTRY_POINT_ABI = [
  "function depositTo(address account) payable",
  "function getDepositInfo(address account) view returns (uint256 deposit, bool staked, uint112 stake, uint32 unstakeDelaySec, uint48 withdrawTime)",
];

interface ChainTarget {
  name: string;
  rpcUrl: string;
  chainId: number;
  explorerUrl: string;
  paymasterAddress: string;
}

const CHAINS: ChainTarget[] = [
  {
    name: "Arc Testnet",
    rpcUrl: "https://rpc.drpc.testnet.arc.network",
    chainId: 5042002,
    explorerUrl: "https://testnet.arcscan.app",
    paymasterAddress: "0xEE39e1690F1bE07e8a68813f57cE3142197CECf6",
  },
  {
    name: "Ethereum Sepolia",
    rpcUrl: "https://ethereum-sepolia-rpc.publicnode.com",
    chainId: 11155111,
    explorerUrl: "https://sepolia.etherscan.io",
    paymasterAddress: "0xe7ED22eF9Af9CAd98B048979dbd726e89dd0D417",
  },
  {
    name: "Base Sepolia",
    rpcUrl: "https://sepolia.base.org",
    chainId: 84532,
    explorerUrl: "https://sepolia.basescan.org",
    paymasterAddress: "0x5f309aE9A9A364Ae18af77b7733bB9C43A032A4A",
  },
  {
    name: "Avalanche Fuji",
    rpcUrl: "https://api.avax-test.network/ext/bc/C/rpc",
    chainId: 43113,
    explorerUrl: "https://testnet.snowtrace.io",
    paymasterAddress: "0x0D3B7bd972F4Cc3CDAB62E1cFafcA79F8d7167f5",
  },
];

async function fundChain(
  chain: ChainTarget,
  privateKey: string,
  depositAmount: bigint
): Promise<void> {
  console.log(`\n📡 Connecting to ${chain.name} (chainId ${chain.chainId})...`);

  const provider = new ethers.JsonRpcProvider(chain.rpcUrl);
  const wallet   = new ethers.Wallet(privateKey, provider);
  const deployer = await wallet.getAddress();
  const balance  = await provider.getBalance(deployer);

  console.log(`   Deployer      : ${deployer}`);
  console.log(`   Balance       : ${ethers.formatEther(balance)} native`);
  console.log(`   Paymaster     : ${chain.paymasterAddress}`);
  console.log(`   EntryPoint    : ${ENTRY_POINT_V07}`);

  if (balance < depositAmount) {
    throw new Error(
      `Insufficient balance — have ${ethers.formatEther(balance)} ETH, need ${ethers.formatEther(depositAmount)} ETH.\n` +
      `Fund the deployer (${deployer}) on ${chain.name} first.`
    );
  }

  const network = await provider.getNetwork();
  if (Number(network.chainId) !== chain.chainId) {
    throw new Error(`Chain ID mismatch: expected ${chain.chainId}, got ${network.chainId}`);
  }

  const entryPoint = new ethers.Contract(ENTRY_POINT_V07, ENTRY_POINT_ABI, wallet);

  const [beforeDeposit] = await entryPoint.getDepositInfo(chain.paymasterAddress) as [bigint];
  console.log(`   Current deposit: ${ethers.formatEther(beforeDeposit)} ETH`);

  console.log(`   Depositing ${ethers.formatEther(depositAmount)} ETH → EntryPoint…`);
  const tx = await entryPoint.depositTo(chain.paymasterAddress, { value: depositAmount });
  console.log(`   Tx: ${chain.explorerUrl}/tx/${tx.hash}`);
  await tx.wait();

  const [afterDeposit] = await entryPoint.getDepositInfo(chain.paymasterAddress) as [bigint];
  console.log(`   ✅ New deposit : ${ethers.formatEther(afterDeposit)} ETH`);
}

async function main() {
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
  if (!privateKey) throw new Error("DEPLOYER_PRIVATE_KEY secret is not set.");

  // Parse --amount flag (default 0.05 ETH)
  const amountIdx = process.argv.indexOf("--amount");
  const amountStr = amountIdx !== -1 ? process.argv[amountIdx + 1] : "0.05";
  let depositAmount: bigint;
  try {
    depositAmount = ethers.parseEther(amountStr);
  } catch {
    throw new Error(`Invalid --amount value: ${amountStr}`);
  }

  // Parse --only flag
  const onlyIdx = process.argv.indexOf("--only");
  const onlyFilter: string[] | null = onlyIdx !== -1
    ? process.argv[onlyIdx + 1].toLowerCase().split(",").map((s) => s.trim())
    : null;

  const chains = onlyFilter
    ? CHAINS.filter((c) => onlyFilter.some((f) => c.name.toLowerCase().includes(f)))
    : CHAINS;

  if (onlyFilter && chains.length === 0) {
    throw new Error(`--only filter "${onlyFilter.join(",")}" matched no chains. Available: ${CHAINS.map((c) => c.name).join(", ")}`);
  }

  console.log("💰 Fund Paymaster — EntryPoint Deposits");
  console.log("════════════════════════════════════════════════");
  console.log(`EntryPoint    : ${ENTRY_POINT_V07}`);
  console.log(`Deposit amount: ${ethers.formatEther(depositAmount)} ETH per chain`);
  if (onlyFilter) console.log(`Chains filter : ${chains.map((c) => c.name).join(", ")}`);

  const failed: string[] = [];

  for (const chain of chains) {
    try {
      await fundChain(chain, privateKey, depositAmount);
    } catch (err) {
      console.error(`\n❌ Failed on ${chain.name}: ${(err as Error).message}`);
      failed.push(chain.name);
    }
  }

  console.log("\n════════════════════════════════════════════════");
  console.log("📄 Summary");
  for (const chain of chains) {
    if (!failed.includes(chain.name)) {
      console.log(`   ✅ ${chain.name.padEnd(20)} ${chain.paymasterAddress}`);
    } else {
      console.log(`   ❌ ${chain.name.padEnd(20)} FAILED`);
    }
  }

  if (failed.length > 0) {
    console.log(`\n⚠️  Failed chains: ${failed.join(", ")}`);
    process.exit(1);
  }

  console.log("\n✅ All Paymasters funded. ERC-4337 UserOps can now be submitted.\n");
  console.log("   Note: The EntryPoint deposit is consumed as users submit UserOps.");
  console.log("   Re-run this script periodically to top up the deposit.\n");
}

main().catch((err) => {
  console.error("\n💥 Fatal:", err.message);
  process.exit(1);
});
