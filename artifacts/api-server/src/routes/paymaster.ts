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
    paymasterAddress: "0x05FCDBf7E7b7c50929D7ccdd32000be30a796E60",
    usdc: "0x3600000000000000000000000000000000000000",
    explorerUrl: "https://testnet.arcscan.app",
  },
  {
    name: "Ethereum Sepolia",
    chainId: 11155111,
    rpcUrl: "https://ethereum-sepolia-rpc.publicnode.com",
    paymasterAddress: "0xE0b2557C27cc358C27376A96493Fa97c3EC58b31",
    usdc: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    explorerUrl: "https://sepolia.etherscan.io",
  },
  {
    name: "Base Sepolia",
    chainId: 84532,
    rpcUrl: "https://sepolia.base.org",
    paymasterAddress: "0x57a298356E6B2A98d44C68Ff92B7372D639684E0",
    usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    explorerUrl: "https://sepolia.basescan.org",
  },
  {
    name: "Avalanche Fuji",
    chainId: 43113,
    rpcUrl: "https://api.avax-test.network/ext/bc/C/rpc",
    paymasterAddress: "0x06e2AF4CD0B05B5c415fBe7Ce256be41a6D8D7F4",
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
