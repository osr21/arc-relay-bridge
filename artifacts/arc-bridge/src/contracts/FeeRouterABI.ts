/**
 * ABI for FeeRouter v2 — CCTP V2, hardened.
 *
 * Security hardening over v1:
 *   - usdc and tokenMessenger are immutable (not caller-supplied).
 *   - Reentrancy lock on bridge().
 *   - Zero mintRecipient rejected.
 *   - rescueTokens() return-value checked.
 *   - MAX_FEE_BPS = 500 (5% hard cap).
 */
export const FEE_ROUTER_ABI = [
  "constructor(address _feeRecipient, uint256 _feeBps, address _usdc, address _tokenMessenger)",

  // Core bridge — 4 params
  "function bridge(uint256 grossAmount, uint32 destinationDomain, bytes32 mintRecipient, uint32 minFinalityThreshold) returns (uint64 nonce)",

  // Views
  "function usdc() view returns (address)",
  "function tokenMessenger() view returns (address)",
  "function owner() view returns (address)",
  "function feeRecipient() view returns (address)",
  "function feeBps() view returns (uint256)",
  "function MAX_FEE_BPS() view returns (uint256)",

  // Admin
  "function setFeeBps(uint256 _feeBps)",
  "function setFeeRecipient(address _feeRecipient)",
  "function transferOwnership(address newOwner)",
  "function rescueTokens(address token, uint256 amount)",

  // Events
  "event BridgeInitiated(address indexed sender, uint256 grossAmount, uint256 feeAmount, uint256 bridgeAmount, uint32 destinationDomain, bytes32 mintRecipient)",
  "event FeeUpdated(uint256 oldBps, uint256 newBps)",
  "event FeeRecipientUpdated(address oldRecipient, address newRecipient)",
  "event OwnershipTransferred(address oldOwner, address newOwner)",
];

/**
 * Deployed FeeRouter v2 addresses per chain ID.
 * Deployed 2025-05-23 (v2 hardened).
 *
 * Arc Testnet is intentionally excluded: its USDC lives at a special system
 * address (0x3600...) that may reject contract-to-contract calls such as the
 * approve() Arc's FeeRouter.bridge() issues internally.  Arc burns use the
 * direct CCTP path (burnWithManualFee) so the user's EOA makes all calls.
 */
export const FEE_ROUTER_ADDRESSES: Record<number, string> = {
  11155111: "0x5B1F511ed4dF76f369671BF1c4aCF0dD84CC0804", // Ethereum Sepolia
  84532:    "0x8d4B57eD464df10414Dde3ADC2E403a01ebc50d8", // Base Sepolia
  43113:    "0x64D160b7E91e78e52dFc0e8829640E32A919164C", // Avalanche Fuji
};

export function getFeeRouterAddress(chainId: number): string | undefined {
  const addr = FEE_ROUTER_ADDRESSES[chainId];
  if (!addr || addr === "0x0000000000000000000000000000000000000000") return undefined;
  return addr;
}
