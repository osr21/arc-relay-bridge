/**
 * Arc Relay SDK — gasless relay API client.
 *
 * Wraps the Arc Relay API (/api/relay, /api/relay/fee, /api/chains) with
 * typed fetch calls. No wallet or ethers.js dependency — pure HTTP.
 */

import type { RelayResult, ChainInfo } from "./types.js";

export interface RelayParams {
  /** Raw CCTP message bytes from the source-chain burn (0x-prefixed hex). */
  message: string;
  /** Circle Iris attestation signature (0x-prefixed hex). */
  attestation: string;
  /** User wallet address on the destination chain that should receive USDC. */
  recipient: string;
  /** EVM chain ID of the destination chain. */
  destChainId: number;
  /**
   * Maximum relay fee the caller accepts, in USDC units (6 decimals).
   * The API rejects the request if the on-chain relayFee exceeds this value.
   * Recommended: pass 2× the expected fee (e.g. "2000000" for a 1 USDC fee).
   */
  maxFee: string;
}

/**
 * Submit a gasless CCTP relay request to the Arc Relay API.
 *
 * The user must have burned USDC with mintRecipient set to the GasRelayer
 * contract address on the destination chain. The API server will call
 * GasRelayer.relay() and forward (amount - relayFee) to `recipient`.
 *
 * @param relayApiBase  Base URL of the Arc Relay API.
 * @param params        Relay request parameters.
 * @returns             Relay result including the destination-chain tx hash.
 */
export async function callRelay(
  relayApiBase: string,
  params: RelayParams,
): Promise<RelayResult> {
  const base = relayApiBase.replace(/\/$/, "");
  const res = await fetch(`${base}/api/relay`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(30_000),
  });

  const data = await res.json().catch(() => ({})) as { txHash?: string; relayFee?: string; chain?: string; error?: string };

  if (!res.ok || !data.txHash) {
    throw new Error(data.error ?? `Relay request failed (HTTP ${res.status})`);
  }

  return {
    txHash:   data.txHash,
    relayFee: data.relayFee ?? "0",
    chain:    data.chain    ?? "",
  };
}

/**
 * Fetch the current relay fee for a destination chain.
 *
 * @param relayApiBase  Base URL of the Arc Relay API.
 * @param destChainId   EVM chain ID of the destination chain.
 * @returns             Relay fee in USDC units (6 decimals) as a bigint.
 */
export async function getRelayFee(
  relayApiBase: string,
  destChainId: number,
): Promise<bigint> {
  const base = relayApiBase.replace(/\/$/, "");
  const res = await fetch(`${base}/api/relay/fee?chainId=${destChainId}`, {
    signal: AbortSignal.timeout(10_000),
  });
  const data = await res.json().catch(() => ({})) as { relayFee?: string; error?: string };

  if (!res.ok || !data.relayFee) {
    throw new Error(data.error ?? `Failed to fetch relay fee (HTTP ${res.status})`);
  }

  return BigInt(data.relayFee);
}

/**
 * Fetch the list of supported chains and their current relay fees.
 *
 * @param relayApiBase  Base URL of the Arc Relay API.
 * @returns             Array of ChainInfo objects.
 */
export async function getSupportedChains(
  relayApiBase: string,
): Promise<ChainInfo[]> {
  const base = relayApiBase.replace(/\/$/, "");
  const res = await fetch(`${base}/api/chains`, {
    signal: AbortSignal.timeout(10_000),
  });
  const data = await res.json().catch(() => ({})) as { chains?: ChainInfo[]; error?: string };

  if (!res.ok || !data.chains) {
    throw new Error(data.error ?? `Failed to fetch chains (HTTP ${res.status})`);
  }

  return data.chains;
}
