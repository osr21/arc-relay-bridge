import { Router, type IRouter } from "express";
import {
  PAYMASTER_ABI,
  GAS_RELAYER_ABI,
  FEE_ROUTER_ABI,
  YIELD_VAULT_ABI,
  ADDRESSES,
  CHAINS,
  COMPILER_SETTINGS,
} from "../data/contractData";

const router: IRouter = Router();

/**
 * GET /api/contracts
 *
 * Returns all deployed contract addresses, ABIs, chain metadata, and
 * compiler settings — everything a developer needs to integrate with the
 * Arc Relay Bridge contracts without cloning the source repo.
 *
 * Response shape:
 *   contracts    — per-contract object with { name, description, abi, addresses, constructorArgs }
 *   chains       — chain metadata (chainId, name, cctpDomain, explorerUrl, usdc)
 *   shared       — Circle CCTP V2 contract addresses (same on all chains)
 *   compiler     — exact solc settings used to produce the deployed bytecode
 *   resources    — links to source repo, explorer pages, and integration docs
 */
router.get("/contracts", (_req, res) => {
  res.json({
    version: "2",
    updatedAt: "2026-06-01",
    network: "testnet",

    contracts: {
      paymaster: {
        name: "Paymaster",
        description:
          "USDC-funded gas sponsorship vault. Users pre-deposit USDC so they never need native tokens. " +
          "Supports both a legacy relayer path (deductGas) and ERC-4337 v0.7 (validatePaymasterUserOp / postOp). " +
          "EntryPoint: 0x0000000071727De22E5E9d8BAf0edAc6f37da032 (constant, same on all EVM chains).",
        abi: PAYMASTER_ABI,
        addresses: ADDRESSES.paymaster,
        constructorArgs: {
          description: "constructor(address usdc, address relayer, address feeRecipient, uint256 gasRate)",
          gasRate: "2",
          gasRateNote: "2 USDC-units per gas unit (6 decimals). Adjust with setGasRate() after deploy.",
        },
        sourceFile: "Paymaster.sol",
        githubUrl: "https://github.com/osr21/arc-relay-contracts/blob/main/contracts/Paymaster.sol",
      },

      gasRelayer: {
        name: "GasRelayer",
        description:
          "Receives CCTP cross-chain USDC burns on behalf of users who lack destination-chain gas. " +
          "A trusted relayer calls relay() which mints USDC to this contract then forwards (amount - relayFee) to the user. " +
          "Set mintRecipient = bytes32(uint256(uint160(gasRelayerAddress))) in your CCTP burn.",
        abi: GAS_RELAYER_ABI,
        addresses: ADDRESSES.gasRelayer,
        constructorArgs: {
          description: "constructor(address usdc, address messageTransmitter, address feeRecipient, uint256 relayFee)",
          messageTransmitter: ADDRESSES.cctpMessageTransmitter,
          relayFee: "1000000",
          relayFeeNote: "1 USDC flat fee (6 decimals). Adjust with setRelayFee() after deploy.",
        },
        relayApiEndpoint: "POST https://arc-relay-bridge.replit.app/api/relay",
        relayApiBody: "{ message, attestation, recipient, destChainId, maxFee }",
        sourceFile: "GasRelayer.sol",
        githubUrl: "https://github.com/osr21/arc-relay-contracts/blob/main/contracts/GasRelayer.sol",
      },

      feeRouter: {
        name: "FeeRouter",
        description:
          "Collects a 0.30% protocol fee and forwards the net USDC to Circle CCTP V2 TokenMessenger in one tx. " +
          "Users approve this contract for the gross amount and call bridge(). " +
          "usdc and tokenMessenger are immutable — set at deploy, not passed as call args (v2 hardening).",
        abi: FEE_ROUTER_ABI,
        addresses: ADDRESSES.feeRouter,
        constructorArgs: {
          description: "constructor(address feeRecipient, uint256 feeBps, address usdc, address tokenMessenger)",
          tokenMessenger: ADDRESSES.cctpTokenMessenger,
          feeBps: "30",
          feeBpsNote: "30 bps = 0.30% protocol fee. Adjust with setFeeBps() (max 500 bps).",
        },
        sourceFile: "FeeRouter_v2.sol",
        githubUrl: "https://github.com/osr21/arc-relay-contracts/blob/main/contracts/FeeRouter_v2.sol",
      },

      yieldVault: {
        name: "YieldVault",
        description:
          "Simulated USDC yield vault. Users deposit USDC and earn APY set by the owner. " +
          "Yield is paid from vault reserves (owner-funded). Different APYs on each chain to incentivise cross-chain rebalancing via the bridge. " +
          "Arc Testnet: 18.5% | Base: 12.3% | Fuji: 9.2% | Sepolia: 7.8%.",
        abi: YIELD_VAULT_ABI,
        addresses: ADDRESSES.yieldVault,
        constructorArgs: {
          description: "constructor(address usdc, uint256 apyBps, string vaultName)",
          apyByChain: { "5042002": 1850, "11155111": 780, "84532": 1230, "43113": 920 },
        },
        sourceFile: "YieldVault.sol",
        githubUrl: "https://github.com/osr21/arc-relay-contracts/blob/main/contracts/YieldVault.sol",
      },
    },

    chains: CHAINS,

    shared: {
      cctpTokenMessenger:     { address: ADDRESSES.cctpTokenMessenger,   note: "Circle CCTP V2 TokenMessenger — same on all 4 chains" },
      cctpMessageTransmitter: { address: ADDRESSES.cctpMessageTransmitter, note: "Circle CCTP V2 MessageTransmitter — same on all 4 chains" },
    },

    compiler: COMPILER_SETTINGS,

    verification: {
      note: "All contracts are single-file (no imports). Paste the .sol source directly into the explorer's Verify Contract form.",
      steps: [
        "1. Open the contract address on the chain's block explorer.",
        "2. Click 'Contract' tab → 'Verify and Publish'.",
        "3. Choose: Solidity (Single file), compiler 0.8.20, optimization ON (200 runs), evmVersion paris.",
        "4. Paste the full source from the githubUrl above.",
        "5. Enter constructor args via the ABI-encoded tool (see constructorArgs field above for values).",
      ],
      explorerUrls: {
        "5042002":  "https://testnet.arcscan.app",
        "11155111": "https://sepolia.etherscan.io",
        "84532":    "https://sepolia.basescan.org",
        "43113":    "https://testnet.snowtrace.io",
      },
    },

    resources: {
      sourceRepo:    "https://github.com/osr21/arc-relay-contracts",
      bridgeApp:     "https://arc-relay-bridge.replit.app",
      circleFaucet:  "https://faucet.circle.com",
      arcDocs:       "https://docs.arc.io",
      cctpDocs:      "https://developers.circle.com/stablecoins/cctp-getting-started",
    },
  });
});

export default router;
