/**
 * Arc Relay SDK — supported chain configurations.
 *
 * All addresses reflect the CCTP V2 testnet deployment.
 * Keep in sync with artifacts/arc-bridge/src/lib/chains.ts.
 */

import type { Chain } from "./types.js";

const TOKEN_MESSENGER    = "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA";
const MSG_TRANSMITTER    = "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275";

export const CHAINS: Record<string, Chain> = {
  ARC_TESTNET: {
    id: 5042002,
    name: "Arc Testnet",
    shortName: "Arc",
    cctpDomain: 26,
    rpcUrl: "https://rpc.drpc.testnet.arc.network",
    usdcAddress: "0x3600000000000000000000000000000000000000",
    tokenMessenger: TOKEN_MESSENGER,
    messageTransmitter: MSG_TRANSMITTER,
    gasRelayerAddress: "0x837D9a19C07bb7B4E95071dC0BaED72D4dE04ea1",
    explorerUrl: "https://testnet.arcscan.app",
    minFinalityThreshold: 2000,
  },
  ETH_SEPOLIA: {
    id: 11155111,
    name: "Ethereum Sepolia",
    shortName: "Sepolia",
    cctpDomain: 0,
    rpcUrl: "https://ethereum-sepolia-rpc.publicnode.com",
    usdcAddress: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    tokenMessenger: TOKEN_MESSENGER,
    messageTransmitter: MSG_TRANSMITTER,
    gasRelayerAddress: "0x5E87F210043D8457caCAd0F0c9aB70a99497Eec9",
    explorerUrl: "https://sepolia.etherscan.io",
    minFinalityThreshold: 1000,
  },
  BASE_SEPOLIA: {
    id: 84532,
    name: "Base Sepolia",
    shortName: "Base",
    cctpDomain: 6,
    rpcUrl: "https://sepolia.base.org",
    usdcAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    tokenMessenger: TOKEN_MESSENGER,
    messageTransmitter: MSG_TRANSMITTER,
    gasRelayerAddress: "0x64D160b7E91e78e52dFc0e8829640E32A919164C",
    explorerUrl: "https://sepolia.basescan.org",
    minFinalityThreshold: 1000,
  },
  FUJI: {
    id: 43113,
    name: "Avalanche Fuji",
    shortName: "Fuji",
    cctpDomain: 1,
    rpcUrl: "https://api.avax-test.network/ext/bc/C/rpc",
    usdcAddress: "0x5425890298aed601595a70AB815c96711a31Bc65",
    tokenMessenger: TOKEN_MESSENGER,
    messageTransmitter: MSG_TRANSMITTER,
    gasRelayerAddress: "0x6F80056564491425273A6a481EcC5DAea9D57f23",
    explorerUrl: "https://testnet.snowtrace.io",
    minFinalityThreshold: 1000,
  },
};

/** All supported chains as a flat array. */
export const ALL_CHAINS: Chain[] = Object.values(CHAINS);

/** Look up a chain by its EVM chain ID. Returns undefined if not supported. */
export function getChainById(id: number): Chain | undefined {
  return ALL_CHAINS.find((c) => c.id === id);
}

/** Look up a chain by its CCTP domain number. Returns undefined if not found. */
export function getChainByCctpDomain(domain: number): Chain | undefined {
  return ALL_CHAINS.find((c) => c.cctpDomain === domain);
}
