/**
 * Fee configuration for the Arc Relay Bridge.
 *
 * To enable fee collection:
 *   1. Set VITE_FEE_RECIPIENT in your environment secrets to your wallet address.
 *   2. Adjust FEE_BPS below (100 bps = 1%).
 *
 * Fee is collected on the source chain via a plain ERC-20 transfer before the
 * CCTP burn — no smart contract deployment required.
 */

/** Fee in basis points. 30 = 0.30%. Set to 0 to disable. */
export const FEE_BPS = 30;

/** Your wallet address to receive fees. Loaded from VITE_FEE_RECIPIENT env var. */
export const FEE_RECIPIENT: string = (import.meta.env.VITE_FEE_RECIPIENT as string) ?? "";

/** Whether fee collection is fully configured and active. */
export function isFeeActive(): boolean {
  return FEE_BPS > 0 && FEE_RECIPIENT.length > 0;
}

export interface FeeBreakdown {
  feeAmount: bigint;     // units (6 decimals)
  bridgeAmount: bigint;  // units (6 decimals)
  feeBps: number;
  feeRecipient: string;
  active: boolean;
}

/**
 * Calculate the fee and net bridge amount from a gross input amount.
 * Always returns a valid breakdown — feeAmount is 0n when fees are inactive.
 */
export function calculateFee(grossAmountInUnits: bigint): FeeBreakdown {
  if (!isFeeActive()) {
    return {
      feeAmount: 0n,
      bridgeAmount: grossAmountInUnits,
      feeBps: 0,
      feeRecipient: FEE_RECIPIENT,
      active: false,
    };
  }
  const feeAmount = (grossAmountInUnits * BigInt(FEE_BPS)) / 10000n;
  const bridgeAmount = grossAmountInUnits - feeAmount;
  return {
    feeAmount,
    bridgeAmount,
    feeBps: FEE_BPS,
    feeRecipient: FEE_RECIPIENT,
    active: feeAmount > 0n,
  };
}

/** Format a units bigint (6 decimals) to a readable string. */
export function formatUsdc(units: bigint): string {
  const whole = units / 1_000_000n;
  const frac = units % 1_000_000n;
  const fracStr = frac.toString().padStart(6, "0").replace(/0+$/, "") || "0";
  return `${whole}.${fracStr}`;
}
