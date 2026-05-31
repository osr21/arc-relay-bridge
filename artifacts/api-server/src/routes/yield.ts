import { Router, type IRouter } from "express";
import { ethers } from "ethers";

const router: IRouter = Router();

const VAULT_ABI = [
  "function apyBps() view returns (uint256)",
  "function vaultName() view returns (string)",
  "function totalDeposited() view returns (uint256)",
  "function currentValue(address) view returns (uint256)",
  "function pendingYield(address) view returns (uint256)",
  "function positions(address) view returns (uint256 principal, uint256 checkpointYield, uint256 lastTimestamp)",
];

interface VaultConfig {
  chainId: number;
  chainName: string;
  shortName: string;
  rpcUrl: string;
  explorerUrl: string;
  logoColor: string;
  vaultAddress: string;
  usdcAddress: string;
}

const VAULTS: VaultConfig[] = [
  {
    chainId: 5042002,
    chainName: "Arc Testnet",
    shortName: "Arc",
    rpcUrl: "https://rpc.drpc.testnet.arc.network",
    explorerUrl: "https://testnet.arcscan.app",
    logoColor: "#354457",
    vaultAddress: "0x9677b4BB48B552E7042619056414Fe69d2b5e204",
    usdcAddress: "0x3600000000000000000000000000000000000000",
  },
  {
    chainId: 11155111,
    chainName: "Ethereum Sepolia",
    shortName: "Sepolia",
    rpcUrl: "https://ethereum-sepolia-rpc.publicnode.com",
    explorerUrl: "https://sepolia.etherscan.io",
    logoColor: "#627EEA",
    vaultAddress: "0xCD75dad98b3bC9bb3Bb153b623772967e77d56F1",
    usdcAddress: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
  },
  {
    chainId: 84532,
    chainName: "Base Sepolia",
    shortName: "Base",
    rpcUrl: "https://sepolia.base.org",
    explorerUrl: "https://sepolia.basescan.org",
    logoColor: "#0052FF",
    vaultAddress: "0xDE761A1b0FC1271AF2D1682158D428Bd12DC710d",
    usdcAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  },
  {
    chainId: 43113,
    chainName: "Avalanche Fuji",
    shortName: "Fuji",
    rpcUrl: "https://api.avax-test.network/ext/bc/C/rpc",
    explorerUrl: "https://testnet.snowtrace.io",
    logoColor: "#E84142",
    vaultAddress: "0x57a298356E6B2A98d44C68Ff92B7372D639684E0",
    usdcAddress: "0x5425890298aed601595a70AB815c96711a31Bc65",
  },
];

async function fetchVaultData(vault: VaultConfig): Promise<{
  chainId: number;
  chainName: string;
  shortName: string;
  logoColor: string;
  explorerUrl: string;
  vaultAddress: string;
  usdcAddress: string;
  apyBps: string;
  apyPercent: string;
  vaultName: string;
  totalDeposited: string;
}> {
  const fallback = {
    chainId: vault.chainId,
    chainName: vault.chainName,
    shortName: vault.shortName,
    logoColor: vault.logoColor,
    explorerUrl: vault.explorerUrl,
    vaultAddress: vault.vaultAddress,
    usdcAddress: vault.usdcAddress,
    apyBps: "0",
    apyPercent: "0.00",
    vaultName: vault.chainName + " Yield Vault",
    totalDeposited: "0",
  };

  if (!vault.vaultAddress || vault.vaultAddress.startsWith("PLACEHOLDER")) {
    return fallback;
  }

  try {
    const provider = new ethers.JsonRpcProvider(vault.rpcUrl);
    const contract = new ethers.Contract(vault.vaultAddress, VAULT_ABI, provider);
    const [apyBps, vaultName, totalDeposited] = await Promise.race([
      Promise.all([
        contract.apyBps() as Promise<bigint>,
        contract.vaultName() as Promise<string>,
        contract.totalDeposited() as Promise<bigint>,
      ]),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 6000)),
    ]);
    const bps = Number(apyBps as bigint);
    return {
      chainId: vault.chainId,
      chainName: vault.chainName,
      shortName: vault.shortName,
      logoColor: vault.logoColor,
      explorerUrl: vault.explorerUrl,
      vaultAddress: vault.vaultAddress,
      usdcAddress: vault.usdcAddress,
      apyBps: (apyBps as bigint).toString(),
      apyPercent: (bps / 100).toFixed(2),
      vaultName: vaultName as string,
      totalDeposited: (totalDeposited as bigint).toString(),
    };
  } catch {
    return fallback;
  }
}

/**
 * GET /api/yield/rates
 *
 * Returns live APY + TVL data for all YieldVault deployments.
 * Reads from each chain's RPC in parallel.
 *
 * Response: { vaults: VaultRateData[] }
 */
router.get("/yield/rates", async (_req, res) => {
  const vaults = await Promise.all(VAULTS.map(fetchVaultData));
  res.json({ vaults });
});

export default router;
