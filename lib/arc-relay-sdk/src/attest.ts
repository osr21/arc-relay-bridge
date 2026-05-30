/**
 * Arc Relay SDK — attestation polling.
 *
 * Polls the Arc Relay API proxy (/api/attest) for a Circle Iris attestation.
 * The proxy avoids CORS issues and provides a fallback between Iris v2/v1.
 */

import type { AttestationResult } from "./types.js";

export interface PollOptions {
  /** How often to poll in milliseconds. Default: 5000 (5 s). */
  pollIntervalMs?: number;
  /** Total timeout in milliseconds. Default: 1_200_000 (20 min). */
  timeoutMs?: number;
  /** Optional callback called each poll with a human-readable status string. */
  onStatus?: (message: string) => void;
}

type AttestationMessage = {
  attestation?: string;
  message?: string;
  status?: string;
};

/**
 * Poll the Arc Relay API until a Circle Iris attestation is ready.
 *
 * @param relayApiBase  Base URL of the Arc Relay API, e.g. "https://arc-relay-bridge.replit.app"
 * @param burnTxHash    Transaction hash of the CCTP depositForBurn on the source chain.
 * @param cctpDomain    CCTP domain number of the source chain (e.g. 0 for Sepolia, 26 for Arc).
 * @param options       Polling configuration.
 * @returns             Resolved attestation with raw message bytes and signature.
 */
export async function pollAttestation(
  relayApiBase: string,
  burnTxHash: string,
  cctpDomain: number,
  options: PollOptions = {},
): Promise<AttestationResult> {
  const {
    pollIntervalMs = 5_000,
    timeoutMs      = 1_200_000,
    onStatus,
  } = options;

  const base    = relayApiBase.replace(/\/$/, "");
  const deadline = Date.now() + timeoutMs;
  let attempt = 0;

  while (Date.now() < deadline) {
    attempt++;
    const elapsed = Math.round((Date.now() - (deadline - timeoutMs)) / 1000);
    const elapsedStr = elapsed > 0 ? ` · ${elapsed}s elapsed` : "";

    try {
      const url = `${base}/api/attest?domain=${cctpDomain}&txHash=${burnTxHash}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });

      if (!res.ok) {
        onStatus?.(`Attestation pending… (attempt ${attempt}${elapsedStr})`);
        await delay(pollIntervalMs);
        continue;
      }

      const data = await res.json() as { messages?: AttestationMessage[]; diagnostic?: string };
      const messages: AttestationMessage[] = data.messages ?? [];

      for (const msg of messages) {
        if (
          msg.attestation &&
          msg.attestation !== "PENDING" &&
          msg.message
        ) {
          onStatus?.("Attestation ready.");
          return { message: msg.message, attestation: msg.attestation };
        }

        const status = msg.status ?? msg.attestation ?? "pending_confirmations";
        onStatus?.(`Waiting for attestation… (attempt ${attempt}${elapsedStr}) — ${status}`);
      }

      if (messages.length === 0) {
        onStatus?.(`Waiting for attestation… (attempt ${attempt}${elapsedStr})`);
      }
    } catch {
      onStatus?.(`Attestation poll error — retrying… (attempt ${attempt}${elapsedStr})`);
    }

    await delay(pollIntervalMs);
  }

  throw new Error(
    `Attestation timed out after ${Math.round(timeoutMs / 60_000)} minutes. ` +
    `Your burn is confirmed on-chain — the attestation will appear eventually. ` +
    `Burn tx: ${burnTxHash}`
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
