export const DOMAINS: Record<number, string> = {
  0: "Ethereum Sepolia",
  1: "Avalanche Fuji",
  6: "Base Sepolia",
  26: "Arc Testnet",
};

export function getDomainName(domainId: number): string {
  return DOMAINS[domainId] || `Domain ${domainId}`;
}

export function formatAddress(address: string): string {
  if (!address || address.length < 10) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function formatAmount(amountUsdc: string | null | undefined): string {
  if (!amountUsdc) return "0.00";
  try {
    const value = Number(amountUsdc) / 1_000_000;
    return value.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 6,
    });
  } catch (e) {
    return "0.00";
  }
}
