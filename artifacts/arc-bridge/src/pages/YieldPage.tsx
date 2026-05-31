import { useState, useEffect, useCallback } from "react";
import {
  TrendingUp, ArrowRight, Zap, RefreshCw, Wallet,
  ChevronUp, Star, AlertCircle, ExternalLink, CheckCircle2,
} from "lucide-react";
import { CHAINS, ChainConfig } from "@/lib/chains";
import { connectWallet, getWalletChainId } from "@/lib/bridge";
import {
  VaultRate, VaultPosition, DepositStatus,
  fetchAllRates, fetchAllPositions, fetchUsdcBalances,
  depositToVault, withdrawFromVault,
  fmtUsdc, fmtApy, friendlyError, isVaultDeployed,
} from "@/lib/yield";
import { WalletButton } from "@/components/WalletButton";
import { TxLink } from "@/components/TxLink";
import { cn } from "@/lib/utils";

const ARC_CHAIN_ID = 5042002;

function ApyBadge({ bps, isBest }: { bps: number; isBest: boolean }) {
  return (
    <div className={cn(
      "flex items-baseline gap-1",
      isBest ? "text-emerald-400" : "text-white"
    )}>
      <span className="text-4xl font-bold tabular-nums">{fmtApy(bps)}</span>
      <span className="text-xl font-semibold opacity-80">%</span>
      <span className="text-sm opacity-60 ml-0.5">APY</span>
    </div>
  );
}

function ChainCard({
  rate,
  isBest,
  position,
  walletAddress,
  walletBalance,
  balanceLoading,
  onDeposit,
  onWithdraw,
}: {
  rate: VaultRate;
  isBest: boolean;
  position: VaultPosition | null;
  walletAddress: string | null;
  walletBalance: bigint | null;
  balanceLoading: boolean;
  onDeposit: (chain: ChainConfig) => void;
  onWithdraw: (chain: ChainConfig) => void;
}) {
  const chain    = rate.chain;
  const tvlUsdc  = Number(rate.totalDeposited) / 1e6;
  const deployed = rate.isDeployed;

  return (
    <div className={cn(
      "relative rounded-2xl border p-5 flex flex-col gap-4 transition-all duration-200",
      isBest
        ? "border-emerald-500/60 bg-emerald-950/30 shadow-lg shadow-emerald-900/20"
        : "border-white/10 bg-white/5 hover:bg-white/8 hover:border-white/20",
    )}>
      {isBest && (
        <div className="absolute -top-3 left-4 flex items-center gap-1.5 bg-emerald-500 text-black text-xs font-bold px-3 py-1 rounded-full">
          <Star className="w-3 h-3 fill-black" />
          Best Rate
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
          <div className="text-xs text-white/40">CCTP Domain {chain.cctpDomain}</div>
        </div>
      </div>

      {/* APY */}
      <div>
        {deployed ? (
          <ApyBadge bps={rate.apyBps} isBest={isBest} />
        ) : (
          <div className="text-white/40 text-sm italic">Vault not yet deployed</div>
        )}
        <div className="text-xs text-white/40 mt-1">
          Simulated testnet rate · TVL {tvlUsdc > 0 ? `${tvlUsdc.toFixed(2)} USDC` : "—"}
        </div>
      </div>

      {/* Wallet balance */}
      {walletAddress && (
        <div className="flex items-center justify-between rounded-xl bg-white/5 border border-white/8 px-3 py-2">
          <span className="text-xs text-white/50">Wallet balance</span>
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
      )}

      {/* User position */}
      {position && (
        <div className="rounded-xl bg-white/8 border border-white/10 px-4 py-3 space-y-1">
          <div className="text-xs text-white/50 uppercase tracking-wider font-medium">Deposited</div>
          <div className="flex justify-between text-sm">
            <span className="text-white/70">Principal</span>
            <span className="text-white font-mono">{fmtUsdc(position.principal)} USDC</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-white/70">Yield earned</span>
            <span className="text-emerald-400 font-mono">+{fmtUsdc(position.pendingYield)} USDC</span>
          </div>
          <div className="flex justify-between text-sm font-semibold border-t border-white/10 pt-1 mt-1">
            <span className="text-white/80">Current value</span>
            <span className="text-white font-mono">{fmtUsdc(position.currentValue)} USDC</span>
          </div>
        </div>
      )}

      {/* Actions */}
      {walletAddress && deployed && (
        <div className="flex gap-2 mt-auto">
          {!position && (
            <button
              onClick={() => onDeposit(chain)}
              disabled={walletBalance !== null && walletBalance === 0n}
              className={cn(
                "flex-1 rounded-xl py-2 text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed",
                isBest
                  ? "bg-emerald-500 hover:bg-emerald-400 text-black"
                  : "bg-white/10 hover:bg-white/20 text-white"
              )}
            >
              {walletBalance !== null && walletBalance === 0n ? "No USDC" : "Deposit"}
            </button>
          )}
          {position && (
            <>
              <button
                onClick={() => onDeposit(chain)}
                disabled={walletBalance !== null && walletBalance === 0n}
                className="flex-1 rounded-xl py-2 text-sm font-semibold bg-white/10 hover:bg-white/20 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
              >
                Add more
              </button>
              <button
                onClick={() => onWithdraw(chain)}
                className="flex-1 rounded-xl py-2 text-sm font-semibold bg-white/10 hover:bg-white/20 text-white transition-colors"
              >
                Withdraw
              </button>
            </>
          )}
        </div>
      )}
      {!walletAddress && deployed && (
        <div className="text-xs text-white/40 text-center mt-auto">Connect wallet to deposit</div>
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
  const [amount, setAmount]   = useState("");
  const [status, setStatus]   = useState<DepositStatus>({ step: "idle", message: "" });

  const maxAmount = walletBalance != null ? Number(walletBalance) / 1e6 : null;

  const handleDeposit = async () => {
    const trimmed = amount.trim();
    if (!trimmed || isNaN(parseFloat(trimmed)) || parseFloat(trimmed) <= 0) return;

    try {
      const units = BigInt(Math.round(parseFloat(trimmed) * 1_000_000));
      await depositToVault(chain, units, setStatus);
      setTimeout(() => { onSuccess(); onClose(); }, 1500);
    } catch (err) {
      setStatus({ step: "error", message: "", error: friendlyError(err) });
    }
  };

  const busy = ["switching", "approving", "depositing"].includes(status.step);
  const parsedAmount = parseFloat(amount);
  const exceedsBalance = maxAmount !== null && !isNaN(parsedAmount) && parsedAmount > maxAmount;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-[#0f1520] border border-white/10 rounded-2xl p-6 w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-white">Deposit to {chain.name}</h2>
          <button onClick={onClose} disabled={busy} className="text-white/40 hover:text-white text-xl leading-none">×</button>
        </div>

        <div className="space-y-4">
          {/* Balance row */}
          {walletBalance !== null && (
            <div className="flex items-center justify-between text-xs px-1">
              <span className="text-white/50">Wallet balance</span>
              <button
                type="button"
                disabled={busy || walletBalance === 0n}
                onClick={() => setAmount(maxAmount!.toFixed(6))}
                className="flex items-center gap-1 text-blue-400 hover:text-blue-300 disabled:opacity-40 disabled:cursor-not-allowed font-semibold transition-colors"
              >
                {fmtUsdc(walletBalance)} USDC
                <span className="bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded text-[10px] font-bold">MAX</span>
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
            disabled={busy || !amount || parseFloat(amount) <= 0}
            className="w-full bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 disabled:cursor-not-allowed text-black font-semibold rounded-xl py-3 transition-colors"
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
  position,
  onClose,
  onSuccess,
}: {
  chain: ChainConfig;
  position: VaultPosition;
  onClose: () => void;
  onSuccess: (received: bigint, chain: ChainConfig) => void;
}) {
  const [status, setStatus] = useState<DepositStatus>({ step: "idle", message: "" });

  const handleWithdraw = async () => {
    try {
      const { txHash, received } = await withdrawFromVault(chain, setStatus);
      setTimeout(() => { onSuccess(received, chain); onClose(); }, 1500);
      void txHash;
    } catch (err) {
      setStatus({ step: "error", message: "", error: friendlyError(err) });
    }
  };

  const busy = ["switching", "depositing"].includes(status.step);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-[#0f1520] border border-white/10 rounded-2xl p-6 w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-white">Withdraw from {chain.name}</h2>
          <button onClick={onClose} disabled={busy} className="text-white/40 hover:text-white text-xl leading-none">×</button>
        </div>

        <div className="space-y-4">
          <div className="rounded-xl bg-white/5 border border-white/10 px-4 py-3 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-white/60">Principal</span>
              <span className="text-white font-mono">{fmtUsdc(position.principal)} USDC</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-white/60">Yield earned</span>
              <span className="text-emerald-400 font-mono">+{fmtUsdc(position.pendingYield)} USDC</span>
            </div>
            <div className="flex justify-between text-sm font-semibold border-t border-white/10 pt-2">
              <span className="text-white">Total to receive</span>
              <span className="text-white font-mono">{fmtUsdc(position.currentValue)} USDC</span>
            </div>
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
            disabled={busy}
            className="w-full bg-white/10 hover:bg-white/20 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold rounded-xl py-3 transition-colors"
          >
            {busy ? "Processing…" : `Withdraw ${fmtUsdc(position.currentValue)} USDC`}
          </button>
        </div>
      </div>
    </div>
  );
}

function OptimizeBanner({
  positions,
  bestRate,
  onWithdraw,
}: {
  positions: VaultPosition[];
  bestRate: VaultRate | null;
  onWithdraw: (chain: ChainConfig) => void;
}) {
  const suboptimal = positions.filter((p) => p.chain.id !== ARC_CHAIN_ID);
  if (suboptimal.length === 0 || !bestRate) return null;

  const arcApy = bestRate.apyBps;
  const best   = suboptimal.reduce((a, b) => {
    const aRate = 0; // current chain APY unknown here — just show first
    const bRate = 0;
    return aRate > bRate ? a : b;
  }, suboptimal[0]);

  return (
    <div className="rounded-2xl border border-amber-500/30 bg-amber-950/30 p-5 flex flex-col sm:flex-row items-start sm:items-center gap-4">
      <div className="p-2 rounded-xl bg-amber-500/20 shrink-0">
        <Zap className="w-5 h-5 text-amber-400" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-amber-300 text-sm">Optimize your yield</div>
        <div className="text-white/60 text-sm mt-0.5">
          You have USDC deposited on {best.chain.name}. Move it to Arc Testnet to earn{" "}
          <span className="text-emerald-400 font-semibold">{fmtApy(arcApy)}% APY</span> instead.
        </div>
      </div>
      <div className="flex gap-2 shrink-0">
        <button
          onClick={() => onWithdraw(best.chain)}
          className="rounded-xl px-4 py-2 text-sm font-semibold bg-amber-500 hover:bg-amber-400 text-black transition-colors"
        >
          Withdraw &amp; Rebalance
        </button>
      </div>
    </div>
  );
}

function RebalanceGuide({
  amount,
  fromChain,
  onDeposit,
  onDismiss,
}: {
  amount: bigint;
  fromChain: ChainConfig;
  onDeposit: () => void;
  onDismiss: () => void;
}) {
  const arcChain = CHAINS.ARC_TESTNET;
  const bridgeUrl = `/?from=${fromChain.id}&to=${arcChain.id}&amount=${(Number(amount) / 1e6).toFixed(6)}`;

  return (
    <div className="rounded-2xl border border-emerald-500/30 bg-emerald-950/20 p-5 space-y-4">
      <div className="flex items-center gap-3">
        <ChevronUp className="w-5 h-5 text-emerald-400" />
        <div className="font-semibold text-emerald-300">Rebalance to Arc Testnet</div>
        <button onClick={onDismiss} className="ml-auto text-white/30 hover:text-white text-xl leading-none">×</button>
      </div>
      <p className="text-sm text-white/60">
        You&apos;ve withdrawn <span className="text-white font-semibold">{fmtUsdc(amount)} USDC</span> from{" "}
        {fromChain.name}. Complete two more steps to deposit it into the Arc Testnet vault at{" "}
        <span className="text-emerald-400 font-semibold">18.50% APY</span>.
      </p>

      {/* Step list */}
      <div className="space-y-2">
        {[
          {
            n: "1",
            done: true,
            label: `Withdrew ${fmtUsdc(amount)} USDC from ${fromChain.name}`,
          },
          {
            n: "2",
            done: false,
            label: "Bridge USDC to Arc Testnet via the bridge",
            action: (
              <a
                href={bridgeUrl}
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition-colors"
              >
                Open Bridge <ExternalLink className="w-3 h-3" />
              </a>
            ),
          },
          {
            n: "3",
            done: false,
            label: "Deposit USDC into the Arc Testnet yield vault",
            action: (
              <button
                onClick={onDeposit}
                className="rounded-lg px-3 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-black text-xs font-semibold transition-colors"
              >
                Deposit on Arc
              </button>
            ),
          },
        ].map((step) => (
          <div key={step.n} className="flex items-center gap-3 text-sm">
            <div className={cn(
              "w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0",
              step.done ? "bg-emerald-500 text-black" : "bg-white/10 text-white/60"
            )}>
              {step.done ? <CheckCircle2 className="w-4 h-4" /> : step.n}
            </div>
            <span className={step.done ? "text-white/40 line-through" : "text-white/80 flex-1"}>
              {step.label}
            </span>
            {step.action && <div className="ml-auto">{step.action}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function YieldPage() {
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [walletChainId, setWalletChainId] = useState<number | null>(null);

  const [rates,     setRates]     = useState<VaultRate[]>([]);
  const [positions, setPositions] = useState<VaultPosition[]>([]);
  const [walletBalances, setWalletBalances] = useState<Record<number, bigint>>({});
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [loading,   setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [depositChain,  setDepositChain]  = useState<ChainConfig | null>(null);
  const [withdrawChain, setWithdrawChain] = useState<ChainConfig | null>(null);
  const [rebalance, setRebalance] = useState<{ amount: bigint; fromChain: ChainConfig } | null>(null);

  const bestRate = rates.reduce<VaultRate | null>((best, r) =>
    r.isDeployed && (!best || r.apyBps > best.apyBps) ? r : best, null
  );

  const load = useCallback(async (addr?: string) => {
    setRefreshing(true);
    try {
      const [ratesData, posData] = await Promise.all([
        fetchAllRates(),
        addr ? fetchAllPositions(addr) : Promise.resolve([]),
      ]);
      setRates(ratesData);
      setPositions(posData);
    } catch {
      // ignore — stale data shown
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const loadBalances = useCallback(async (addr: string) => {
    setBalanceLoading(true);
    try {
      const bals = await fetchUsdcBalances(addr);
      setWalletBalances(bals);
    } catch {
      // non-fatal
    } finally {
      setBalanceLoading(false);
    }
  }, []);

  useEffect(() => { void load(walletAddress ?? undefined); }, [load, walletAddress]);

  function handleWalletConnect(addr: string, chainId: number) {
    setWalletAddress(addr);
    setWalletChainId(chainId);
    void load(addr);
    void loadBalances(addr);
  }

  function handleWithdrawSuccess(received: bigint, fromChain: ChainConfig) {
    setRebalance({ amount: received, fromChain });
    void load(walletAddress ?? undefined);
  }

  const sortedRates = [...rates].sort((a, b) => b.apyBps - a.apyBps);
  const isBest = (r: VaultRate) => r.chain.id === bestRate?.chain.id;
  const positionFor = (r: VaultRate) => positions.find((p) => p.chain.id === r.chain.id) ?? null;
  const arcRate = rates.find((r) => r.chain.id === ARC_CHAIN_ID) ?? null;

  void walletChainId; // used for chain-switch awareness

  return (
    <div className="min-h-screen bg-[#0a0f1a] text-white">
      {/* Header */}
      <header className="border-b border-white/8 px-4 sm:px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/20 flex items-center justify-center">
              <TrendingUp className="w-4 h-4 text-emerald-400" />
            </div>
            <div>
              <div className="font-bold text-base text-white leading-tight">Yield Optimizer</div>
              <div className="text-xs text-white/40 hidden sm:block">Cross-chain USDC yield routing via Arc Relay</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <a
              href="/"
              className="text-sm text-white/50 hover:text-white transition-colors hidden sm:block"
            >
              ← Bridge
            </a>
            <button
              onClick={() => void load(walletAddress ?? undefined)}
              disabled={refreshing}
              className="p-2 rounded-xl text-white/40 hover:text-white hover:bg-white/5 transition-colors"
              title="Refresh rates"
            >
              <RefreshCw className={cn("w-4 h-4", refreshing && "animate-spin")} />
            </button>
            <WalletButton
              onConnect={handleWalletConnect}
              address={walletAddress}
              chainId={walletChainId}
            />
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-8">

        {/* Hero */}
        <div className="text-center space-y-2">
          <h1 className="text-2xl sm:text-3xl font-bold text-white">
            Put your USDC to work
          </h1>
          <p className="text-white/50 max-w-lg mx-auto text-sm sm:text-base">
            Deposit USDC on any chain and earn simulated yield. Use the bridge to move to the
            highest-rate vault automatically.
          </p>
          {!walletAddress && (
            <button
              onClick={async () => {
                try {
                  const addr = await connectWallet();
                  const cid  = await getWalletChainId();
                  handleWalletConnect(addr, cid);
                  void loadBalances(addr);
                } catch { /* user cancelled */ }
              }}
              className="inline-flex items-center gap-2 mt-4 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-sm transition-colors"
            >
              <Wallet className="w-4 h-4" />
              Connect Wallet to Start
            </button>
          )}
        </div>

        {/* Optimize banner */}
        {positions.some((p) => p.chain.id !== ARC_CHAIN_ID) && (
          <OptimizeBanner
            positions={positions}
            bestRate={arcRate}
            onWithdraw={(chain) => setWithdrawChain(chain)}
          />
        )}

        {/* Rebalance guide (shown after withdraw) */}
        {rebalance && (
          <RebalanceGuide
            amount={rebalance.amount}
            fromChain={rebalance.fromChain}
            onDeposit={() => {
              setDepositChain(CHAINS.ARC_TESTNET);
              setRebalance(null);
            }}
            onDismiss={() => setRebalance(null)}
          />
        )}

        {/* APY card grid */}
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="rounded-2xl border border-white/8 bg-white/4 h-52 animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-2">
            {sortedRates.map((rate) => (
              <ChainCard
                key={rate.chain.id}
                rate={rate}
                isBest={isBest(rate)}
                position={positionFor(rate)}
                walletAddress={walletAddress}
                walletBalance={walletAddress ? (walletBalances[rate.chain.id] ?? null) : null}
                balanceLoading={balanceLoading}
                onDeposit={(chain) => setDepositChain(chain)}
                onWithdraw={(chain) => setWithdrawChain(chain)}
              />
            ))}
          </div>
        )}

        {/* Your positions */}
        {positions.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-base font-semibold text-white/80">Your Positions</h2>
            <div className="space-y-2">
              {positions.map((pos) => {
                const rate = rates.find((r) => r.chain.id === pos.chain.id);
                const notBest = pos.chain.id !== ARC_CHAIN_ID;
                return (
                  <div
                    key={pos.chain.id}
                    className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-2xl border border-white/10 bg-white/4 px-5 py-4"
                  >
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                      style={{ backgroundColor: pos.chain.logoColor }}
                    >
                      {pos.chain.shortName.slice(0, 2)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-sm text-white">{pos.chain.name}</div>
                      <div className="text-xs text-white/40">
                        {rate ? `${fmtApy(rate.apyBps)}% APY` : ""} · {fmtUsdc(pos.principal)} USDC deposited
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-white font-semibold font-mono text-sm">{fmtUsdc(pos.currentValue)} USDC</div>
                      <div className="text-emerald-400 text-xs font-mono">+{fmtUsdc(pos.pendingYield)} yield</div>
                    </div>
                    {notBest && (
                      <button
                        onClick={() => setWithdrawChain(pos.chain)}
                        className="flex items-center gap-1.5 shrink-0 rounded-xl px-3 py-2 text-xs font-semibold bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/20 transition-colors"
                      >
                        Optimize <ArrowRight className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Footer note */}
        <div className="rounded-xl border border-white/6 bg-white/3 px-5 py-4 text-xs text-white/40 space-y-1">
          <div className="flex items-center gap-1.5 text-white/50 font-medium text-sm">
            <AlertCircle className="w-3.5 h-3.5" />
            Testnet simulation
          </div>
          <p>
            APYs shown are simulated rates for Arc Testnet demonstration purposes only. Yield accumulates
            in real-time on-chain but the vaults are not backed by a real lending protocol.
            Deposits use real testnet USDC — withdraw at any time with no lock-up.
          </p>
        </div>
      </main>

      {/* Modals */}
      {depositChain && (
        <DepositModal
          chain={depositChain}
          walletBalance={walletAddress ? (walletBalances[depositChain.id] ?? null) : null}
          onClose={() => setDepositChain(null)}
          onSuccess={() => {
            void load(walletAddress ?? undefined);
            if (walletAddress) void loadBalances(walletAddress);
          }}
        />
      )}
      {withdrawChain && (
        <WithdrawModal
          chain={withdrawChain}
          position={positions.find((p) => p.chain.id === withdrawChain.id)!}
          onClose={() => setWithdrawChain(null)}
          onSuccess={handleWithdrawSuccess}
        />
      )}
    </div>
  );
}
