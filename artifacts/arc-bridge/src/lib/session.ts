import { ethers } from "ethers";

/**
 * Bridge session persistence — saves in-progress bridge state to localStorage
 * so the user can resume after a page refresh or accidental close.
 */

export interface BridgeSession {
  burnTxHash: string;
  feeTxHash?: string;
  messageBytes?: string;
  messageHash?: string;
  sourceMessageHash?: string;
  sourceLogIndex?: number;
  fromChainId: number;
  toChainId: number;
  amount: string;
  amountUnits: string;
  recipient: string;
  savedAt: number;
}

const SESSION_KEY = "arc_bridge_session_v2_mainnet";

export function saveSession(session: BridgeSession): void {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // Storage may be unavailable (private mode, quota exceeded) — ignore
  }
}

export function loadSession(): BridgeSession | null {
  try {
    // A testnet resume is never surfaced in a mainnet-preparing build.
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as BridgeSession;
    if (
      typeof session.burnTxHash !== "string" ||
      !/^0x[0-9a-fA-F]{64}$/.test(session.burnTxHash) ||
      (session.fromChainId !== 5042 && session.fromChainId !== 8453) ||
      (session.toChainId !== 5042 && session.toChainId !== 8453) ||
      session.fromChainId === session.toChainId ||
      typeof session.savedAt !== "number" ||
      // amount must be a plain decimal string (no scientific notation, no injection)
      typeof session.amount !== "string" ||
      typeof session.amountUnits !== "string" ||
      !/^\d+$/.test(session.amountUnits) ||
      (() => { try { return ethers.parseUnits(session.amount.trim(), 6).toString() !== session.amountUnits; } catch { return true; } })() ||
      !/^\d+(\.\d{1,6})?$/.test(session.amount.trim()) ||
      // recipient must be a valid 0x-prefixed 20-byte Ethereum address
      typeof session.recipient !== "string" ||
      !/^0x[0-9a-fA-F]{40}$/.test(session.recipient) ||
      // messageBytes, if present, must be a 0x-prefixed hex string of even byte pairs (valid bytes)
      (session.messageBytes !== undefined && (
        typeof session.messageBytes !== "string" ||
        !/^0x([0-9a-fA-F]{2}){1,1024}$/.test(session.messageBytes)
      )) ||
      (session.messageBytes !== undefined && (
       typeof session.messageHash !== "string" ||
       !/^0x[0-9a-fA-F]{64}$/.test(session.messageHash) ||
       ethersHashMismatch(session.messageBytes, session.messageHash))) ||
      ((session.sourceMessageHash !== undefined || session.sourceLogIndex !== undefined) &&
       (typeof session.sourceMessageHash !== "string" ||
        !/^0x[0-9a-fA-F]{64}$/.test(session.sourceMessageHash) ||
        typeof session.sourceLogIndex !== "number" || session.sourceLogIndex < 0)) ||
      // feeTxHash, if present, must be a valid 0x-prefixed 32-byte tx hash
      (session.feeTxHash !== undefined && (
        typeof session.feeTxHash !== "string" ||
        !/^0x[0-9a-fA-F]{64}$/.test(session.feeTxHash)
      ))
    ) {
      clearSession();
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

function ethersHashMismatch(message: string, hash: string): boolean {
  // Keccak is verified again against the source receipt before any resume.
  // Keep this parser strict here without importing wallet/runtime code.
  try { return ethers.keccak256(message).toLowerCase() !== hash.toLowerCase(); }
  catch { return true; }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {}
}
