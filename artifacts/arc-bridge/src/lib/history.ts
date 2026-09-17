
/**
 * Bridge history — persists the last MAX_ENTRIES completed bridge transfers
 * to localStorage so users can review past transactions.
 */

export interface BridgeHistoryEntry {
  id: string;
  fromChainId: number;
  toChainId: number;
  amount: string;
  burnTxHash: string;
  mintTxHash?: string;
  completedAt: number;
}

const HISTORY_KEY = "arc_bridge_history_v2_mainnet";
const MAX_ENTRIES = 10;

export function saveBridgeHistory(entry: Omit<BridgeHistoryEntry, "id">): void {
  try {
    const existing = loadBridgeHistory();
    const newEntry: BridgeHistoryEntry = {
      ...entry,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    };
    const updated = [newEntry, ...existing].slice(0, MAX_ENTRIES);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
  } catch {
    // Storage unavailable — non-fatal
  }
}

export function loadBridgeHistory(): BridgeHistoryEntry[] {
  try {
    // Preserve existing users' legacy history only in the explicit testnet app.
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is BridgeHistoryEntry =>
        typeof e === "object" &&
        e !== null &&
        typeof (e as BridgeHistoryEntry).id === "string" &&
        typeof (e as BridgeHistoryEntry).fromChainId === "number" &&
        typeof (e as BridgeHistoryEntry).toChainId === "number" &&
        typeof (e as BridgeHistoryEntry).amount === "string" &&
        // burnTxHash must be a valid 0x-prefixed 32-byte tx hash
        typeof (e as BridgeHistoryEntry).burnTxHash === "string" &&
        /^0x[0-9a-fA-F]{64}$/.test((e as BridgeHistoryEntry).burnTxHash) &&
        // mintTxHash, if present, must also be a valid tx hash
        ((e as BridgeHistoryEntry).mintTxHash === undefined ||
          /^0x[0-9a-fA-F]{64}$/.test((e as BridgeHistoryEntry).mintTxHash!)) &&
        typeof (e as BridgeHistoryEntry).completedAt === "number"
    );
  } catch {
    return [];
  }
}

export function clearBridgeHistory(): void {
  try {
    localStorage.removeItem(HISTORY_KEY);
  } catch {}
}
