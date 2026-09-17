import { Router, type IRouter } from "express";
import { ethers } from "ethers";
import { isMainnetProfile, mainnetChainsForResponse } from "../lib/network";

const router: IRouter = Router();

const RELAY_FEE_ABI = ["function relayFee() view returns (uint256)"];

const CHAIN_DEFS = [
  {
    id: 5042002,
    name: "Arc Testnet",
    shortName: "Arc",
    cctpDomain: 26,
    usdcAddress: "0x3600000000000000000000000000000000000000",
    gasRelayerAddress: "0xf89773D7d9C43c01203793bf991e2550975a0C49", // v2-hardened
    explorerUrl: "https://testnet.arcscan.app",
    rpcUrl: "https://rpc.drpc.testnet.arc.network",
  },
  {
    id: 11155111,
    name: "Ethereum Sepolia",
    shortName: "Sepolia",
    cctpDomain: 0,
    usdcAddress: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    gasRelayerAddress: "0x5eA2A91629245074D01EFf64fc223233c2a805E6", // v2-hardened
    explorerUrl: "https://sepolia.etherscan.io",
    rpcUrl: "https://ethereum-sepolia-rpc.publicnode.com",
  },
  {
    id: 84532,
    name: "Base Sepolia",
    shortName: "Base",
    cctpDomain: 6,
    usdcAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    gasRelayerAddress: "0x5bE70628f49aFb90D81d169bff1533F437B967BB", // v2-hardened
    explorerUrl: "https://sepolia.basescan.org",
    rpcUrl: "https://sepolia.base.org",
  },
  {
    id: 43113,
    name: "Avalanche Fuji",
    shortName: "Fuji",
    cctpDomain: 1,
    usdcAddress: "0x5425890298aed601595a70AB815c96711a31Bc65",
    gasRelayerAddress: "0x53183000a7Ae24AE9F1126271a66Eff1161a58Ec", // v2-hardened
    explorerUrl: "https://testnet.snowtrace.io",
    rpcUrl: "https://api.avax-test.network/ext/bc/C/rpc",
  },
];

async function fetchRelayFee(rpcUrl: string, relayerAddress: string): Promise<string> {
  try {
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const contract = new ethers.Contract(relayerAddress, RELAY_FEE_ABI, provider);
    const fee = await Promise.race([
      contract.relayFee() as Promise<bigint>,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 5000)),
    ]);
    return (fee as bigint).toString();
  } catch {
    return "1000000"; // fallback: 1 USDC
  }
}

/**
 * GET /api/chains
 *
 * Returns all supported chains with their current relay fees queried live
 * from the on-chain GasRelayer contracts.
 *
 * Response:
 *   { chains: ChainInfo[] }
 *
 * ChainInfo fields:
 *   id, name, shortName, cctpDomain, usdcAddress, gasRelayerAddress,
 *   explorerUrl, relayFeeUnits (string, 6 decimals)
 */
router.get("/chains", async (_req, res) => {
  if (isMainnetProfile()) {
    // There are no reviewed custom relay deployments on mainnet. Only publish
    // official Arc/Base network and CCTP descriptors; deliberately omit any
    // gas-relayer address and fee rather than reusing testnet values.
    res.json({ chains: mainnetChainsForResponse() });
    return;
  }

  const chains = await Promise.all(
    CHAIN_DEFS.map(async (c) => ({
      id:                c.id,
      name:              c.name,
      shortName:         c.shortName,
      cctpDomain:        c.cctpDomain,
      usdcAddress:       c.usdcAddress,
      gasRelayerAddress: c.gasRelayerAddress,
      explorerUrl:       c.explorerUrl,
      relayFeeUnits:     await fetchRelayFee(c.rpcUrl, c.gasRelayerAddress),
    }))
  );

  res.json({ chains });
});

export default router;
