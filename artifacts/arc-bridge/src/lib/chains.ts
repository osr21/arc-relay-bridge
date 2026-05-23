export interface ChainConfig {
  id: number;
  hexId: string;
  name: string;
  shortName: string;
  rpcUrl: string;
  explorerUrl: string;
  cctpDomain: number;
  usdcAddress: string;
  tokenMessenger: string;
  messageTransmitter: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  isArc?: boolean;
  logoColor: string;
}

export const CHAINS: Record<string, ChainConfig> = {
  ARC_TESTNET: {
    id: 5042002,
    hexId: "0x4CEF52",
    name: "Arc Testnet",
    shortName: "Arc",
    rpcUrl: "https://rpc.drpc.testnet.arc.network",
    explorerUrl: "https://explorer.testnet.arc.network",
    cctpDomain: 7,
    usdcAddress: "0x3600000000000000000000000000000000000000",
    tokenMessenger: "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAD",
    messageTransmitter: "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275",
    nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
    isArc: true,
    logoColor: "#354457",
  },
  ETH_SEPOLIA: {
    id: 11155111,
    hexId: "0xaa36a7",
    name: "Ethereum Sepolia",
    shortName: "Sepolia",
    rpcUrl: "https://rpc.sepolia.org",
    explorerUrl: "https://sepolia.etherscan.io",
    cctpDomain: 0,
    usdcAddress: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    tokenMessenger: "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA",
    messageTransmitter: "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    logoColor: "#627EEA",
  },
  BASE_SEPOLIA: {
    id: 84532,
    hexId: "0x14A34",
    name: "Base Sepolia",
    shortName: "Base Sep",
    rpcUrl: "https://sepolia.base.org",
    explorerUrl: "https://sepolia.basescan.org",
    cctpDomain: 6,
    usdcAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    tokenMessenger: "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA",
    messageTransmitter: "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    logoColor: "#0052FF",
  },
  AVAX_FUJI: {
    id: 43113,
    hexId: "0xA869",
    name: "Avalanche Fuji",
    shortName: "Fuji",
    rpcUrl: "https://api.avax-test.network/ext/bc/C/rpc",
    explorerUrl: "https://testnet.snowtrace.io",
    cctpDomain: 1,
    usdcAddress: "0x5425890298aed601595a70AB815c96711a31Bc65",
    tokenMessenger: "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA",
    messageTransmitter: "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275",
    nativeCurrency: { name: "AVAX", symbol: "AVAX", decimals: 18 },
    logoColor: "#E84142",
  },
};

export const CHAIN_LIST = Object.values(CHAINS);

export function getChainById(id: number): ChainConfig | undefined {
  return CHAIN_LIST.find((c) => c.id === id);
}

export const ATTESTATION_API = "https://iris-api-sandbox.circle.com";

export const USDC_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function transfer(address to, uint256 amount) returns (bool)",
];

export const TOKEN_MESSENGER_ABI = [
  "function depositForBurn(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken) returns (uint64 nonce)",
  "event MessageSent(bytes message)",
];

export const MESSAGE_TRANSMITTER_ABI = [
  "function receiveMessage(bytes message, bytes attestation) returns (bool success)",
  "function usedNonces(bytes32 sourceAndNonce) view returns (uint256)",
];
