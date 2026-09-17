/** Format a units bigint (6 decimals) to a readable string. */
export function formatUsdc(units: bigint): string {
  const whole = units / 1_000_000n;
  const frac = units % 1_000_000n;
  const fracStr = frac.toString().padStart(6, "0").replace(/0+$/, "") || "0";
  return `${whole}.${fracStr}`;
}
