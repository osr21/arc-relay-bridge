/**
 * Arc Relay SDK — fee calculation utilities.
 */

import type { FeeBreakdown } from "./types.js";

/** Flat gasless relay fee in USDC units (6 decimals). Matches GasRelayer.relayFee() on-chain. */
export const GAS_RELAY_FEE_UNITS = 1_000_000n;

/** Protocol fee in basis points (30 = 0.30%). */
export const PROTOCOL_FEE_BPS = 30;

/**
 * Calculate the full fee breakdown for a bridge transfer.
 *
 * @param grossUnits    Input amount in USDC units (6 decimals).
 * @param useGasRelay   Whether to include the gasless relay fee.
 * @param feeBps        Protocol fee in basis points (default: 30 = 0.30%).
 */
export function calculateFee(
  grossUnits: bigint,
  useGasRelay = false,
  feeBps: number = PROTOCOL_FEE_BPS,
): FeeBreakdown {
  const protocolFee  = (grossUnits * BigInt(feeBps)) / 10_000n;
  const bridgeAmount = grossUnits - protocolFee;
  const relayFee     = useGasRelay ? GAS_RELAY_FEE_UNITS : 0n;
  const netAmount    = bridgeAmount - relayFee;

  return { grossAmount: grossUnits, protocolFee, bridgeAmount, relayFee, netAmount, feeBps };
}

/**
 * Format a USDC units value (6 decimals) to a human-readable string.
 * e.g. 1_500_000n → "1.5"
 */
export function formatUsdc(units: bigint): string {
  const sign  = units < 0n ? "-" : "";
  const abs   = units < 0n ? -units : units;
  const whole = abs / 1_000_000n;
  const frac  = abs % 1_000_000n;
  const fracStr = frac.toString().padStart(6, "0").replace(/0+$/, "") || "0";
  return `${sign}${whole}.${fracStr}`;
}

/**
 * Parse a human-readable USDC string (e.g. "1.5") to USDC units (bigint, 6 decimals).
 * Throws if the string is not a valid positive decimal.
 */
export function parseUsdc(value: string): bigint {
  const trimmed = value.trim();
  if (!/^\d+(\.\d{0,6})?$/.test(trimmed)) {
    throw new Error(`Invalid USDC amount: "${value}"`);
  }
  const [whole, frac = ""] = trimmed.split(".");
  const fracPadded = frac.padEnd(6, "0").slice(0, 6);
  return BigInt(whole) * 1_000_000n + BigInt(fracPadded);
}
