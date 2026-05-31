import { useState, useEffect, useCallback } from "react";
import {
  Zap, RefreshCw, Wallet, AlertCircle, CheckCircle2,
  ShieldCheck, ArrowDownCircle, ArrowUpCircle, Info,
} from "lucide-react";
import { CHAINS, ChainConfig } from "@/lib/chains";
import { connectWallet } from "@/lib/bridge";
import {
  PaymasterBalance, PaymasterStatus,
  fetchAllBalances, fetchWalletBalance,
  depositToPaymaster, withdrawFromPaymaster,
  fmtUsdc, friendlyError, isPaymasterDeployed,
} from "@/lib/paymaster";
import { WalletButton } from "@/components/WalletButton";
import { TxLink } from "@/components/TxLink";
import { cn } from "@/lib/utils";

function StatBadge({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 px-5 py-4 flex flex-col gap-1">
      <div className="text-xs text-white/40 uppercase tracking-wider font-medium">{label}</div>
      <div className="text-2xl font-bold text-white tabular-nums">{value}</div>
      {sub && <div className="text-xs text-white/40">{sub}</div>}
    </div>
  );
}

function ChainCard({
  pm,
  walletBalance,
  balanceLoading,
  onDeposit,
  onWithdraw,
}: {
  pm: PaymasterBalance;
  walletBalance: bigint | null;
  balanceLoading: boolean;
  onDeposit: (chain: ChainConfig) => void;
  onWithdraw: (chain: ChainConfig) => void;
}) {
  const chain    = pm.chain;
  const deployed = pm.isDeployed;
  const hasBal   = pm.balance > 0n;

  return (
    <div className={cn(
      "relative rounded-2xl border p-5 flex flex-col gap-4 transition-all duration-200",
      hasBal
        ? "border-violet-500/50 bg-violet-950/20 shadow-lg shadow-violet-900/10"
        : "border-white/10 bg-white/5 hover:bg-white/8 hover:border-white/20"
    )}>
      {hasBal && (
        <div className="absolute -top-3 left-4 flex items-center gap-1.5 bg-violet-500 text-white text-xs font-bold px-3 py-1 rounded-full">
          <ShieldCheck className="w-3 h-3" />
          Active
        </div>
      )}

      {/* Chain header */}
      <div className="flex items-center gap-3">
        <div
          className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0"
          style={{ backgroundColor: chain.logoColor }}
        >
          {chain.shortName.slice(0, 2)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-white leading-tight">{chain.name}</div>
          {deployed ? (
            <div className="text-xs text-white/40">Max 10 USDC / tx · Cap enforced on-chain</div>
          ) : (
            <div className="text-xs text-amber-400/70">Paymaster not yet deployed</div>
          )}
        </div>
      </div>

      {/* Gas balance */}
      {deployed && (
        <div className="rounded-xl bg-white/8 border border-white/10 px-4 py-3 space-y-1.5">
          <div className="text-xs text-white/50 uppercase tracking-wider font-medium">Gas Balance</div>
          <div className="flex justify-between items-baseline">
            <span className="text-2xl font-bold font-mono text-white">
              {fmtUsdc(pm.balance)}
            </span>
            <span className="text-sm text-white/50">USDC</span>
          </div>
          {pm.gasRate > 0n && (
            <div className="text-xs text-white/35">
              Gas rate: {pm.gasRate.toString()} USDC-units / gas unit
            </div>
          )}
        </div>
      )}

      {/* Wallet USDC balance */}
      <div className="flex items-center justify-between rounded-xl bg-white/5 border border-white/8 px-3 py-2">
        <span className="text-xs text-white/50">Wallet USDC</span>
        {balanceLoading && walletBalance === null ? (
          <span className="text-xs text-white/30 animate-pulse">loading…</span>
        ) : (
          <span className={cn(
            "text-xs font-mono font-semibold",
            walletBalance && walletBalance > 0n ? "text-white" : "text-white/35"
          )}>
            {walletBalance !== null ? `${fmtUsdc(walletBalance)} USDC` : "—"}
          </span>
        )}
      </div>

      {/* Actions */}
      {deployed && (
        <div className="flex gap-2 mt-auto">
          <button
            onClick={() => onDeposit(chain)}
            disabled={walletBalance !== null && walletBalance === 0n}
            className={cn(
              "flex-1 flex items-center justify-center gap-1.5 rounded-xl py-2 text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed",
              hasBal
                ? "bg-white/10 hover:bg-white/20 text-white"
                : "bg-violet-600 hover:bg-violet-500 text-white"
            )}
          >
            <ArrowDownCircle className="w-4 h-4" />
            {walletBalance !== null && walletBalance === 0n ? "No USDC" : "Deposit"}
          </button>
          {hasBal && (
            <button
              onClick={() => onWithdraw(chain)}
              className="flex-1 flex items-center justify-center gap-1.5 rounded-xl py-2 text-sm font-semibold bg-white/10 hover:bg-white/20 text-white transition-colors"
            >
              <ArrowUpCircle className="w-4 h-4" />
              Withdraw
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function DepositModal({
  chain,
  walletBalance,
  onClose,
  onSuccess,
}: {
  chain: ChainConfig;
  walletBalance: bigint | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState<PaymasterStatus>({ step: "idle", message: "" });

  const maxAmount = walletBalance != null ? Number(walletBalance) / 1e6 : null;
  const parsedAmount  = parseFloat(amount);
  const exceedsBalance = maxAmount !== null && !isNaN(parsedAmount) && parsedAmount > maxAmount;
  const busy = ["switching", "approving", "depositing"].includes(status.step);

  const handleDeposit = async () => {
    const trimmed = amount.trim();
    if (!trimmed || isNaN(parseFloat(trimmed)) || parseFloat(trimmed) <= 0) return;
    try {
      const units = BigInt(Math.round(parseFloat(trimmed) * 1_000_000));
      await depositToPaymaster(chain, units, setStatus);
      setTimeout(() => { onSuccess(); onClose(); }, 1500);
    } catch (err) {
      setStatus({ step: "error", message: "", error: friendlyError(err) });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-[#0f1520] border border-white/10 rounded-2xl p-6 w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-white">Deposit Gas Balance — {chain.name}</h2>
          <button onClick={onClose} disabled={busy} className="text-white/40 hover:text-white text-xl leading-none">×</button>
        </div>

        <div className="rounded-xl bg-violet-950/30 border border-violet-500/20 px-4 py-3 mb-4 text-xs text-violet-300/80 flex gap-2">
          <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>
            This USDC covers gas so you can transact without holding native tokens.
            The relayer deducts at most <strong>10 USDC per transaction</strong>.
          </span>
        </div>

        <div className="space-y-4">
          {walletBalance !== null && (
            <div className="flex items-center justify-between text-xs px-1">
              <span className="text-white/50">Wallet balance</span>
              <button
                type="button"
                disabled={busy || walletBalance === 0n}
                onClick={() => setAmount(maxAmount!.toFixed(6))}
                className="flex items-center gap-1 text-violet-400 hover:text-violet-300 disabled:opacity-40 disabled:cursor-not-allowed font-semibold transition-colors"
              >
                {fmtUsdc(walletBalance)} USDC
                <span className="bg-violet-500/20 text-violet-400 px-1.5 py-0.5 rounded text-[10px] font-bold">MAX</span>
              </button>
            </div>
          )}

          <div>
            <label className="text-sm text-white/60 mb-1.5 block">USDC Amount</label>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              disabled={busy}
              className={cn(
                "w-full bg-white/5 border rounded-xl px-4 py-3 text-white text-lg placeholder-white/20 focus:outline-none disabled:opacity-50",
                exceedsBalance ? "border-red-500/50 focus:border-red-400" : "border-white/10 focus:border-white/30"
              )}
            />
            {exceedsBalance && (
              <p className="text-red-400 text-xs mt-1.5 px-1">Exceeds wallet balance of {fmtUsdc(walletBalance!)} USDC</p>
            )}
          </div>

          {status.step !== "idle" && (
            <div className={cn(
              "rounded-xl px-4 py-3 text-sm",
              status.step === "error" ? "bg-red-900/30 border border-red-500/30 text-red-300" :
              status.step === "done"  ? "bg-emerald-900/30 border border-emerald-500/30 text-emerald-300" :
              "bg-blue-900/30 border border-blue-500/30 text-blue-300"
            )}>
              <div className="flex items-center gap-2">
                {status.step === "done"  && <CheckCircle2 className="w-4 h-4 shrink-0" />}
                {status.step === "error" && <AlertCircle className="w-4 h-4 shrink-0" />}
                {busy && <RefreshCw className="w-4 h-4 shrink-0 animate-spin" />}
                <span>{status.error ?? status.message}</span>
              </div>
              {status.txHash && (
                <div className="mt-1.5">
                  <TxLink hash={status.txHash} chain={chain} />
                </div>
              )}
            </div>
          )}

          <button
            onClick={handleDeposit}
            disabled={busy || !amount || parseFloat(amount) <= 0 || exceedsBalance}
            className="w-full bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold rounded-xl py-3 transition-colors"
          >
            {busy ? "Processing…" : "Confirm Deposit"}
          </button>
        </div>
      </div>
    </div>
  );
}

function WithdrawModal({
  chain,
  balance,
  onClose,
  onSuccess,
}: {
  chain: ChainConfig;
  balance: bigint;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState<PaymasterStatus>({ step: "idle", message: "" });

  const maxAmount = Number(balance) / 1e6;
  const parsedAmount = parseFloat(amount);
  const exceedsBalance = !isNaN(parsedAmount) && parsedAmount > maxAmount;
  const busy = ["switching", "withdrawing"].includes(status.step);

  const handleWithdraw = async () => {
    const trimmed = amount.trim();
    if (!trimmed || isNaN(parseFloat(trimmed)) || parseFloat(trimmed) <= 0) return;
    try {
      const units = BigInt(Math.round(parseFloat(trimmed) * 1_000_000));
      await withdrawFromPaymaster(chain, units, setStatus);
      setTimeout(() => { onSuccess(); onClose(); }, 1500);
    } catch (err) {
      setStatus({ step: "error", message: "", error: friendlyError(err) });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-[#0f1520] border border-white/10 rounded-2xl p-6 w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-white">Withdraw Gas Balance — {chain.name}</h2>
          <button onClick={onClose} disabled={busy} className="text-white/40 hover:text-white text-xl leading-none">×</button>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between text-xs px-1">
            <span className="text-white/50">Available balance</span>
            <button
              type="button"
              disabled={busy}
              onClick={() => setAmount(maxAmount.toFixed(6))}
              className="flex items-center gap-1 text-violet-400 hover:text-violet-300 disabled:opacity-40 disabled:cursor-not-allowed font-semibold transition-colors"
            >
              {fmtUsdc(balance)} USDC
              <span className="bg-violet-500/20 text-violet-400 px-1.5 py-0.5 rounded text-[10px] font-bold">MAX</span>
            </button>
          </div>

          <div>
            <label className="text-sm text-white/60 mb-1.5 block">USDC Amount</label>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              disabled={busy}
              className={cn(
                "w-full bg-white/5 border rounded-xl px-4 py-3 text-white text-lg placeholder-white/20 focus:outline-none disabled:opacity-50",
                exceedsBalance ? "border-red-500/50 focus:border-red-400" : "border-white/10 focus:border-white/30"
              )}
            />
            {exceedsBalance && (
              <p className="text-red-400 text-xs mt-1.5 px-1">Exceeds available balance of {fmtUsdc(balance)} USDC</p>
            )}
          </div>

          {status.step !== "idle" && (
            <div className={cn(
              "rounded-xl px-4 py-3 text-sm",
              status.step === "error" ? "bg-red-900/30 border border-red-500/30 text-red-300" :
              status.step === "done"  ? "bg-emerald-900/30 border border-emerald-500/30 text-emerald-300" :
              "bg-blue-900/30 border border-blue-500/30 text-blue-300"
            )}>
              <div className="flex items-center gap-2">
                {status.step === "done"  && <CheckCircle2 className="w-4 h-4 shrink-0" />}
                {status.step === "error" && <AlertCircle className="w-4 h-4 shrink-0" />}
                {busy && <RefreshCw className="w-4 h-4 shrink-0 animate-spin" />}
                <span>{status.error ?? status.message}</span>
              </div>
              {status.txHash && (
                <div className="mt-1.5">
                  <TxLink hash={status.txHash} chain={chain} />
                </div>
              )}
            </div>
          )}

          <button
            onClick={handleWithdraw}
            disabled={busy || !amount || parseFloat(amount) <= 0 || exceedsBalance}
            className="w-full bg-white/10 hover:bg-white/20 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold rounded-xl py-3 transition-colors"
          >
            {busy ? "Processing…" : `Withdraw ${!isNaN(parsedAmount) && parsedAmount > 0 ? `${parsedAmount.toFixed(2)} USDC` : ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function PaymasterPage() {
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [walletChainId, setWalletChainId] = useState<number | null>(null);

  const [balances,      setBalances]      = useState<PaymasterBalance[]>([]);
  const [walletBals,    setWalletBals]    = useState<Record<number, bigint>>({});
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [loading,       setLoading]       = useState(false);
  const [refreshing,    setRefreshing]    = useState(false);

  const [depositChain,  setDepositChain]  = useState<ChainConfig | null>(null);
  const [withdrawChain, setWithdrawChain] = useState<ChainConfig | null>(null);

  const chains = Object.values(CHAINS) as ChainConfig[];

  const totalGasBalance = balances.reduce((s, b) => s + b.balance, 0n);
  const deployedCount   = balances.filter((b) => b.isDeployed).length;

  const load = useCallback(async (addr?: string) => {
    if (!addr) return;
    setRefreshing(true);
    try {
      const bals = await fetchAllBalances(addr);
      setBalances(bals);
    } catch {
      // non-fatal
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const loadWalletBals = useCallback(async (addr: string) => {
    setBalanceLoading(true);
    try {
      const results = await Promise.allSettled(
        chains.map(async (c) => ({ chainId: c.id, bal: await fetchWalletBalance(c, addr) }))
      );
      const map: Record<number, bigint> = {};
      for (const r of results) {
        if (r.status === "fulfilled") map[r.value.chainId] = r.value.bal;
      }
      setWalletBals(map);
    } catch {
      // non-fatal
    } finally {
      setBalanceLoading(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handleWalletConnect(addr: string, chainId?: number) {
    setWalletAddress(addr);
    if (chainId !== undefined) setWalletChainId(chainId);
    void load(addr);
    void loadWalletBals(addr);
  }

  const depositModalBalance = depositChain ? (walletBals[depositChain.id] ?? null) : null;
  const withdrawModalBalance = withdrawChain
    ? (balances.find((b) => b.chain.id === withdrawChain.id)?.balance ?? 0n)
    : 0n;

  const noDeployed = !loading && deployedCount === 0;

  return (
    <div className="min-h-screen bg-[#0a0f1a] text-white">
      {/* Header */}
      <header className="border-b border-white/8 px-4 sm:px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-violet-500/20 flex items-center justify-center">
              <Zap className="w-4 h-4 text-violet-400" />
            </div>
            <div>
              <div className="font-bold text-base text-white leading-tight">Gas Paymaster</div>
              <div className="text-xs text-white/40 hidden sm:block">Deposit USDC — transact without native tokens</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <a href="/" className="text-sm text-white/50 hover:text-white transition-colors hidden sm:block">← Bridge</a>
            <a href="/yield" className="text-sm text-white/50 hover:text-white transition-colors hidden sm:block">Yield →</a>
            <button
              onClick={() => void load(walletAddress ?? undefined)}
              disabled={refreshing || !walletAddress}
              className="p-2 rounded-xl text-white/40 hover:text-white hover:bg-white/5 transition-colors disabled:opacity-30"
              title="Refresh"
            >
              <RefreshCw className={cn("w-4 h-4", refreshing && "animate-spin")} />
            </button>
            <WalletButton
              address={walletAddress}
              chainId={walletChainId}
              onConnect={(addr, chainId) => handleWalletConnect(addr, chainId)}
            />
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-8">
        {/* How it works */}
        <div className="rounded-2xl border border-violet-500/20 bg-violet-950/20 p-5 space-y-3">
          <div className="flex items-center gap-2 text-violet-300 font-semibold text-sm">
            <ShieldCheck className="w-4 h-4" />
            How the Paymaster works
          </div>
          <div className="grid sm:grid-cols-3 gap-3 text-xs text-white/60">
            {[
              { n: "1", label: "Deposit USDC", desc: "Pre-fund your gas account on any chain" },
              { n: "2", label: "Submit txs normally", desc: "The relayer pays native gas on your behalf" },
              { n: "3", label: "USDC deducted", desc: "The equivalent gas cost is subtracted from your balance (max 10 USDC per tx)" },
            ].map((s) => (
              <div key={s.n} className="flex gap-3 items-start">
                <div className="w-6 h-6 rounded-full bg-violet-500/20 text-violet-400 text-xs font-bold flex items-center justify-center shrink-0">
                  {s.n}
                </div>
                <div>
                  <div className="font-semibold text-white/80">{s.label}</div>
                  <div>{s.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Stats */}
        {walletAddress && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <StatBadge
              label="Total Gas Balance"
              value={`${fmtUsdc(totalGasBalance)} USDC`}
              sub="across all chains"
            />
            <StatBadge
              label="Chains Funded"
              value={balances.filter((b) => b.balance > 0n).length.toString()}
              sub={`of ${deployedCount} deployed`}
            />
            <StatBadge
              label="Max Per Tx"
              value="10 USDC"
              sub="enforced on-chain"
            />
          </div>
        )}

        {/* No wallet */}
        {!walletAddress && (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-10 flex flex-col items-center gap-4 text-center">
            <div className="w-12 h-12 rounded-2xl bg-violet-500/10 flex items-center justify-center">
              <Wallet className="w-6 h-6 text-violet-400" />
            </div>
            <div>
              <div className="font-semibold text-white mb-1">Connect your wallet</div>
              <div className="text-sm text-white/50">See your gas balances and deposit USDC to enable gasless transactions</div>
            </div>
            <button
              onClick={async () => {
                try {
                  const addr = await connectWallet();
                  handleWalletConnect(addr);
                } catch { /* user cancelled */ }
              }}
              className="bg-violet-600 hover:bg-violet-500 text-white font-semibold rounded-xl px-6 py-2.5 transition-colors text-sm"
            >
              Connect Wallet
            </button>
          </div>
        )}

        {/* Paymaster not yet deployed notice */}
        {walletAddress && noDeployed && (
          <div className="rounded-2xl border border-amber-500/20 bg-amber-950/20 p-5 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold text-amber-300 text-sm">Paymaster not yet deployed</div>
              <div className="text-xs text-white/50 mt-1">
                Run <code className="bg-white/10 px-1.5 py-0.5 rounded text-white/80">pnpm --filter @workspace/scripts run deploy-paymaster</code> to deploy the contract to all chains, then update <code className="bg-white/10 px-1.5 py-0.5 rounded text-white/80">PAYMASTER_ADDRESSES</code> in <code className="bg-white/10 px-1.5 py-0.5 rounded text-white/80">src/lib/paymaster.ts</code>.
              </div>
            </div>
          </div>
        )}

        {/* Chain cards */}
        {walletAddress && (
          <div className="grid sm:grid-cols-2 gap-4">
            {chains.map((chain) => {
              const pm = balances.find((b) => b.chain.id === chain.id) ?? {
                chain,
                paymasterAddress: "",
                balance: 0n,
                gasRate: 0n,
                paused: false,
                isDeployed: isPaymasterDeployed(chain.id),
              };
              return (
                <ChainCard
                  key={chain.id}
                  pm={pm}
                  walletBalance={walletBals[chain.id] ?? null}
                  balanceLoading={balanceLoading}
                  onDeposit={(c) => setDepositChain(c)}
                  onWithdraw={(c) => setWithdrawChain(c)}
                />
              );
            })}
          </div>
        )}
      </main>

      {/* Modals */}
      {depositChain && (
        <DepositModal
          chain={depositChain}
          walletBalance={depositModalBalance}
          onClose={() => setDepositChain(null)}
          onSuccess={() => void load(walletAddress ?? undefined)}
        />
      )}
      {withdrawChain && (
        <WithdrawModal
          chain={withdrawChain}
          balance={withdrawModalBalance}
          onClose={() => setWithdrawChain(null)}
          onSuccess={() => void load(walletAddress ?? undefined)}
        />
      )}
    </div>
  );
}
