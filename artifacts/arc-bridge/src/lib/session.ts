/**
 * Bridge session persistence — saves in-progress bridge state to localStorage
 * so the user can resume after a page refresh or accidental close.
 */

export interface BridgeSession {
  burnTxHash: string;
  feeTxHash?: string;
  messageBytes?: string;
  fromChainId: number;
  toChainId: number;
  amount: string;
  recipient: string;
  savedAt: number;
}

const SESSION_KEY = "arc_bridge_session_v1";
const MAX_AGE_MS  = 48 * 60 * 60 * 1000; // 48 hours

export function saveSession(session: BridgeSession): void {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // Storage may be unavailable (private mode, quota exceeded) — ignore
  }
}

export function loadSession(): BridgeSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as BridgeSession;
    if (
      typeof session.burnTxHash !== "string" ||
      !/^0x[0-9a-fA-F]{64}$/.test(session.burnTxHash) ||
      typeof session.fromChainId !== "number" ||
      typeof session.toChainId !== "number" ||
      typeof session.savedAt !== "number" ||
      // amount must be a plain decimal string (no scientific notation, no injection)
      typeof session.amount !== "string" ||
      !/^\d+(\.\d{1,6})?$/.test(session.amount.trim()) ||
      // messageBytes, if present, must be a 0x-prefixed hex string of reasonable length
      (session.messageBytes !== undefined && (
        typeof session.messageBytes !== "string" ||
        !/^0x[0-9a-fA-F]{2,2048}$/.test(session.messageBytes)
      ))
    ) {
      clearSession();
      return null;
    }
    if (Date.now() - session.savedAt > MAX_AGE_MS) {
      clearSession();
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {}
}
