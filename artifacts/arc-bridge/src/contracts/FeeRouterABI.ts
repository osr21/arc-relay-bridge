/**
 * ABI for the FeeRouter contract.
 * Source: contracts/FeeRouter.sol (solc 0.8.20, optimizer 200 runs)
 */
export const FEE_ROUTER_ABI = [
  "function bridge(uint256 grossAmount, uint32 destinationDomain, bytes32 mintRecipient, address usdc, address tokenMessenger) returns (uint64 nonce)",
  "function owner() view returns (address)",
  "function feeRecipient() view returns (address)",
  "function feeBps() view returns (uint256)",
  "event BridgeInitiated(address indexed sender, uint256 grossAmount, uint256 feeAmount, uint256 bridgeAmount, uint32 destinationDomain, bytes32 mintRecipient, address usdc, address tokenMessenger)",
];

/**
 * Deployed FeeRouter addresses per chain ID.
 * Populated by running: pnpm --filter @workspace/scripts run deploy
 * Then committed / or imported from deployments.json at runtime.
 */
export const FEE_ROUTER_ADDRESSES: Record<number, string> = {
  // Filled in after deployment — run the deploy script first.
  // 5042002:  "0x...",  // Arc Testnet
  // 11155111: "0x...",  // Ethereum Sepolia
  // 84532:    "0x...",  // Base Sepolia
  // 43113:    "0x...",  // Avalanche Fuji
};

export function getFeeRouterAddress(chainId: number): string | undefined {
  return FEE_ROUTER_ADDRESSES[chainId];
}
