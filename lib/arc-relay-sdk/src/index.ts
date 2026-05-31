/**
 * @workspace/arc-relay-sdk
 *
 * TypeScript SDK for the Arc Relay Bridge.
 *
 * Provides:
 *  - Chain configs and helpers (CHAINS, getChainById, getChainByCctpDomain)
 *  - Fee calculation (calculateFee, formatUsdc, parseUsdc, GAS_RELAY_FEE_UNITS)
 *  - Attestation polling (pollAttestation)
 *  - Relay API client (callRelay, getRelayFee, getSupportedChains)
 *  - TypeScript types (Chain, FeeBreakdown, AttestationResult, RelayResult, ChainInfo)
 *
 * @example
 * ```ts
 * import { CHAINS, calculateFee, pollAttestation, callRelay } from "@workspace/arc-relay-sdk";
 *
 * const fee = calculateFee(parseUsdc("10"), true);
 * console.log("You receive:", formatUsdc(fee.netAmount), "USDC");
 *
 * const attest = await pollAttestation("https://arc-relay-bridge.replit.app", burnTxHash, 0);
 * const result = await callRelay("https://arc-relay-bridge.replit.app", {
 *   message:     attest.message,
 *   attestation: attest.attestation,
 *   recipient:   "0xYourWallet",
 *   destChainId: 5042002,
 *   maxFee:      "2000000",
 * });
 * console.log("Relay tx:", result.txHash);
 * ```
 */

export type {
  Chain,
  FeeBreakdown,
  AttestationResult,
  RelayResult,
  ChainInfo,
} from "./types.js";

export {
  CHAINS,
  ALL_CHAINS,
  getChainById,
  getChainByCctpDomain,
} from "./chains.js";

export {
  GAS_RELAY_FEE_UNITS,
  PROTOCOL_FEE_BPS,
  calculateFee,
  formatUsdc,
  parseUsdc,
} from "./fees.js";

export {
  pollAttestation,
  type PollOptions,
} from "./attest.js";

export {
  callRelay,
  getRelayFee,
  getSupportedChains,
  type RelayParams,
} from "./relay.js";
