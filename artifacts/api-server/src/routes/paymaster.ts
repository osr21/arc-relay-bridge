import { Router } from "express";
import { ethers } from "ethers";

const router = Router();

const PAYMASTER_ABI = [
  "function balances(address user) view returns (uint256)",
  "function gasRate() view returns (uint256)",
  "function paused() view returns (bool)",
  "function MAX_DEDUCTION_PER_TX() view returns (uint256)",
];

interface ChainInfo {
  name: string;
  chainId: number;
  rpcUrl: string;
  paymasterAddress: string;
  usdc: string;
  explorerUrl: string;
}

const CHAINS: ChainInfo[] = [
  {
    name: "Arc Testnet",
    chainId: 5042002,
    rpcUrl: "https://rpc.drpc.testnet.arc.network",
    paymasterAddress: "0xfD06D288d481515a986DF28030AF013De290D76C", // v5
    usdc: "0x3600000000000000000000000000000000000000",
    explorerUrl: "https://testnet.arcscan.app",
  },
  {
    name: "Ethereum Sepolia",
    chainId: 11155111,
    rpcUrl: "https://ethereum-sepolia-rpc.publicnode.com",
    paymasterAddress: "0xC9E9ba0bfE58FA438B8B6f2182d3ADA3669F9Eb4", // v5
    usdc: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    explorerUrl: "https://sepolia.etherscan.io",
  },
  {
    name: "Base Sepolia",
    chainId: 84532,
    rpcUrl: "https://sepolia.base.org",
    paymasterAddress: "0xe355E9dCdEAB37eA8fd81b9457Ad2C56d3eE9055", // v5
    usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    explorerUrl: "https://sepolia.basescan.org",
  },
  {
    name: "Avalanche Fuji",
    chainId: 43113,
    rpcUrl: "https://api.avax-test.network/ext/bc/C/rpc",
    paymasterAddress: "0x7C75A75B59b63871e1Bb47fA63e541F0e5975f93", // v5
    usdc: "0x5425890298aed601595a70AB815c96711a31Bc65",
    explorerUrl: "https://testnet.snowtrace.io",
  },
];

/**
 * GET /api/paymaster/chains
 * Returns all chains with paymaster config.
 */
router.get("/paymaster/chains", (_req, res) => {
  res.json({
    chains: CHAINS.map((c) => ({
      chainId: c.chainId,
      name: c.name,
      paymasterAddress: c.paymasterAddress || null,
      usdc: c.usdc,
      explorerUrl: c.explorerUrl,
      deployed: !!c.paymasterAddress,
    })),
  });
});

/**
 * GET /api/paymaster/balance/:address
 * Returns the user's USDC gas balance across all deployed paymaster chains.
 */
router.get("/paymaster/balance/:address", async (req, res) => {
  const { address } = req.params;

  if (!ethers.isAddress(address)) {
    res.status(400).json({ error: "Invalid address" });
    return;
  }

  const deployed = CHAINS.filter((c) => !!c.paymasterAddress);

  if (deployed.length === 0) {
    res.json({
      address,
      balances: [],
      totalUsdcRaw: "0",
      totalUsdc: "0.000000",
      note: "No paymaster contracts deployed yet. Run deploy-paymaster script.",
    });
    return;
  }

  const results = await Promise.allSettled(
    deployed.map(async (chain) => {
      const provider = new ethers.JsonRpcProvider(chain.rpcUrl);
      const contract = new ethers.Contract(chain.paymasterAddress, PAYMASTER_ABI, provider);
      const [balance, gasRate, paused] = await Promise.all([
        contract.balances(address) as Promise<bigint>,
        contract.gasRate()         as Promise<bigint>,
        contract.paused()          as Promise<boolean>,
      ]);
      return {
        chainId: chain.chainId,
        name: chain.name,
        paymasterAddress: chain.paymasterAddress,
        balance: balance.toString(),
        balanceUsdc: (Number(balance) / 1e6).toFixed(6),
        gasRate: gasRate.toString(),
        paused,
        explorerUrl: chain.explorerUrl,
      };
    })
  );

  const balances = results.map((r, i) =>
    r.status === "fulfilled"
      ? r.value
      : {
          chainId: deployed[i].chainId,
          name: deployed[i].name,
          paymasterAddress: deployed[i].paymasterAddress,
          balance: null,
          balanceUsdc: null,
          gasRate: null,
          paused: null,
          error: (r.reason as Error)?.message ?? "RPC error",
          explorerUrl: deployed[i].explorerUrl,
        }
  );

  const total = balances.reduce((sum, b) => {
    if (b.balance) return sum + BigInt(b.balance);
    return sum;
  }, 0n);

  res.json({
    address,
    balances,
    totalUsdcRaw: total.toString(),
    totalUsdc: (Number(total) / 1e6).toFixed(6),
  });
});

export default router;
