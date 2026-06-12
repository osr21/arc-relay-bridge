const API_BASE = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api`;

export interface GasRefuelQuote {
  destChainId: number;
  destChain: string;
  nativeSymbol: string;
  usdcAmount: string;
  nativeAmount: string;
  nativeAmountFormatted: string;
  serviceFeePercent: string;
  depositAddress: string;
  liquidityAvailable: string;
  liquidityFormatted: string;
  sufficient: boolean;
  validUntil: number;
}

export interface GasRefuelResult {
  fulfillmentTxHash: string;
  destChainId: number;
  destChain: string;
  nativeAmount: string;
  nativeAmountFormatted: string;
  nativeSymbol: string;
  recipient: string;
  usdcUsedFormatted: string;
  explorerUrl: string;
}

export interface LiquidityEntry {
  chainId: number;
  name: string;
  shortName: string;
  symbol: string;
  balance: string | null;
  balanceFormatted: string | null;
  error?: string;
  explorerUrl: string;
}

export async function fetchRefuelQuote(
  destChainId: number,
  usdcUnits: string
): Promise<GasRefuelQuote> {
  const url = `${API_BASE}/gasrefuel/quote?destChainId=${destChainId}&usdcAmount=${usdcUnits}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
  const data: unknown = await res.json();
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Quote failed: ${res.status}`);
  return data as GasRefuelQuote;
}

export async function submitRefuel(
  arcTxHash: string,
  destChainId: number,
  recipient: string
): Promise<GasRefuelResult> {
  const url = `${API_BASE}/gasrefuel/submit`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ arcTxHash, destChainId, recipient }),
    signal: AbortSignal.timeout(30_000),
  });
  const data: unknown = await res.json();
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Submit failed: ${res.status}`);
  return data as GasRefuelResult;
}

export async function fetchLiquidity(): Promise<{
  deployerAddress: string;
  liquidity: LiquidityEntry[];
}> {
  const url = `${API_BASE}/gasrefuel/liquidity`;
  const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
  const data: unknown = await res.json();
  if (!res.ok) throw new Error((data as { error?: string }).error ?? "Liquidity check failed");
  return data as { deployerAddress: string; liquidity: LiquidityEntry[] };
}

/** Parse a human-readable USDC string (e.g. "1.5") into 6-decimal units string */
export function usdcToUnits(amount: string): string {
  const n = parseFloat(amount);
  if (!isFinite(n) || n <= 0) return "0";
  return Math.round(n * 1_000_000).toString();
}

/** Format 6-decimal USDC units to a human-readable string */
export function unitsToUsdc(units: string): string {
  return (Number(units) / 1_000_000).toFixed(6).replace(/\.?0+$/, "");
}
