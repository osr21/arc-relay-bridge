import { useState, useEffect, useCallback } from "react";
import { RefreshCw, ExternalLink, ArrowRight, Wallet, Globe, ChevronRight } from "lucide-react";
import { CHAINS, ChainConfig, USDC_ABI } from "@/lib/chains";
import { connectWallet, getWalletChainId } from "@/lib/bridge";
import { WalletButton } from "@/components/WalletButton";
import { cn } from "@/lib/utils";
import { ethers } from "ethers";

// ── Chain order for the portfolio view ───────────────────────────────────────
const PORTFOLIO_CHAINS: ChainConfig[] = [
  CHAINS.ARC_TESTNET,
  CHAINS.ETH_SEPOLIA,
  CHAINS.BASE_SEPOLIA,
  CHAINS.AVAX_FUJI,
];

const APY_MAP: Record<number, number | null> = {
  [CHAINS.ARC_TESTNET.id]:   18.5,
  [CHAINS.ETH_SEPOLIA.id]:    7.8,
  [CHAINS.BASE_SEPOLIA.id]:  12.3,
  [CHAINS.AVAX_FUJI.id]:      9.2,
};

type ChainBalance = {
  chain: ChainConfig;
  balance: bigint | null;   // null = loading
  error: boolean;
};

async function fetchUsdcBalanceRaw(address: string, chain: ChainConfig): Promise<bigint> {
  const rpcs = [chain.rpcUrl, ...chain.rpcFallbacks];
  let lastErr: unknown;
  for (const rpc of rpcs) {
    try {
      const provider = new ethers.JsonRpcProvider(rpc);
      const usdc = new ethers.Contract(chain.usdcAddress, USDC_ABI, provider);
      return await usdc.balanceOf(address) as bigint;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

function fmtUsdc(raw: bigint): string {
  return (Number(raw) / 1e6).toFixed(2);
}

function fmtUsdcFull(raw: bigint): string {
  const n = Number(raw) / 1e6;
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function bridgeToArcUrl(fromChainId: number): string {
  return `/?from=${fromChainId}`;
}

// ── Chain card ───────────────────────────────────────────────────────────────

function ChainBalanceCard({
  entry,
  isArc,
  walletAddress,
}: {
  entry: ChainBalance;
  isArc: boolean;
  walletAddress: string;
}) {
  const { chain, balance, error } = entry;
  const apy = APY_MAP[chain.id];
  const hasBalance = balance !== null && balance > 0n;

  return (
    <div className={cn(
      "bg-[#111827]/80 border rounded-2xl p-5 flex flex-col gap-4 transition-all",
      isArc
        ? "border-[#4F9CF9]/40 shadow-lg shadow-[#4F9CF9]/5"
        : "border-white/[0.06]"
    )}>
      {/* Chain header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div
            className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0"
            style={{ background: chain.logoColor }}
          >
            {isArc ? "⬡" : chain.shortName.charAt(0)}
          </div>
          <div>
            <p className="text-sm font-semibold text-white leading-none">{chain.name}</p>
            <p className="text-[10px] text-slate-500 mt-0.5">CCTP Domain {chain.cctpDomain}</p>
          </div>
        </div>
        {isArc && (
          <span className="px-2 py-0.5 bg-[#4F9CF9]/10 border border-[#4F9CF9]/20 rounded-full text-[10px] text-[#4F9CF9] font-medium">
            Home
          </span>
        )}
      </div>

      {/* Balance */}
      <div>
        {balance === null && !error ? (
          <div className="flex items-center gap-2 text-slate-500">
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            <span className="text-xs">Loading…</span>
          </div>
        ) : error ? (
          <p className="text-xs text-red-400">Failed to load</p>
        ) : (
          <p className="text-3xl font-bold text-white tabular-nums">
            {fmtUsdc(balance!)}
            <span className="text-base font-normal text-slate-400 ml-1.5">USDC</span>
          </p>
        )}
        {apy !== null && (
          <p className="text-[11px] text-slate-500 mt-1">
            Vault APY:{" "}
            <span className={cn("font-semibold", isArc ? "text-emerald-400" : "text-slate-300")}>
              {apy}%
            </span>
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 mt-auto">
        {!isArc && (
          <a
            href={bridgeToArcUrl(chain.id)}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-[#4F9CF9]/10 hover:bg-[#4F9CF9]/20 border border-[#4F9CF9]/20 hover:border-[#4F9CF9]/40 text-[#4F9CF9] text-xs font-medium rounded-xl transition-all"
          >
            Bridge to Arc <ArrowRight className="w-3 h-3" />
          </a>
        )}
        {isArc && hasBalance && (
          <a
            href="/yield"
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 text-emerald-400 text-xs font-medium rounded-xl transition-all"
          >
            Earn Yield <ChevronRight className="w-3 h-3" />
          </a>
        )}
        <a
          href={`${chain.explorerUrl}/address/${walletAddress}`}
          target="_blank"
          rel="noopener noreferrer"
          className="px-3 py-2 bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.06] text-slate-400 text-xs rounded-xl transition-all flex items-center gap-1.5"
        >
          Explorer <ExternalLink className="w-3 h-3" />
        </a>
      </div>
    </div>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────

export default function PortfolioPage() {
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [walletChainId, setWalletChainId] = useState<number | null>(null);
  const [balances, setBalances] = useState<ChainBalance[]>(
    PORTFOLIO_CHAINS.map((c) => ({ chain: c, balance: null, error: false }))
  );
  const [loading, setLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  function handleWalletConnect(addr: string, chainId: number) {
    setWalletAddress(addr);
    setWalletChainId(chainId);
  }

  const refreshBalances = useCallback(async (address: string) => {
    setLoading(true);
    setBalances(PORTFOLIO_CHAINS.map((c) => ({ chain: c, balance: null, error: false })));

    await Promise.allSettled(
      PORTFOLIO_CHAINS.map(async (chain, idx) => {
        try {
          const raw = await fetchUsdcBalanceRaw(address, chain);
          setBalances((prev) => {
            const next = [...prev];
            next[idx] = { chain, balance: raw, error: false };
            return next;
          });
        } catch {
          setBalances((prev) => {
            const next = [...prev];
            next[idx] = { chain, balance: null, error: true };
            return next;
          });
        }
      })
    );

    setLoading(false);
    setLastRefresh(new Date());
  }, []);

  useEffect(() => {
    if (walletAddress) void refreshBalances(walletAddress);
  }, [walletAddress, refreshBalances]);

  // Listen for wallet account/chain changes
  useEffect(() => {
    const eth = window.ethereum;
    if (!eth) return;
    const onAccounts = (accounts: unknown) => {
      const accs = accounts as string[];
      if (accs[0]) {
        setWalletAddress(accs[0]);
        setWalletChainId(null);
      } else {
        setWalletAddress(null);
      }
    };
    const onChain = (hex: unknown) => {
      setWalletChainId(parseInt(hex as string, 16));
    };
    eth.on?.("accountsChanged", onAccounts);
    eth.on?.("chainChanged", onChain);
    return () => {
      eth.removeListener?.("accountsChanged", onAccounts);
      eth.removeListener?.("chainChanged", onChain);
    };
  }, []);

  // Compute totals
  const totalRaw = balances.reduce((sum, b) => sum + (b.balance ?? 0n), 0n);
  const allLoaded = balances.every((b) => b.balance !== null || b.error);

  return (
    <div className="min-h-screen bg-[#0a0f1a] text-white">

      {/* ── Header ── */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06]">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#354457] to-[#4F9CF9] flex items-center justify-center">
            <span className="text-white text-sm font-bold">⬡</span>
          </div>
          <div>
            <h1 className="text-white font-bold text-base leading-none">Arc Relay Bridge</h1>
            <p className="text-slate-500 text-[11px] mt-0.5">Portfolio · USDC Across Chains</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <a href="/"           className="text-xs text-[#4F9CF9]  hover:text-blue-300   font-medium transition-colors">Bridge ↗</a>
          <a href="/yield"      className="text-xs text-emerald-400 hover:text-emerald-300 font-medium transition-colors">Yield ↗</a>
          <a href="/paymaster"  className="text-xs text-violet-400 hover:text-violet-300  font-medium transition-colors">Paymaster ↗</a>
          <a href="/refuel"     className="text-xs text-orange-400 hover:text-orange-300  font-medium transition-colors">Refuel ↗</a>
          <WalletButton
            address={walletAddress}
            chainId={walletChainId}
            onConnect={handleWalletConnect}
          />
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-10 space-y-8">

        {/* ── Page title ── */}
        <div className="space-y-1">
          <h2 className="text-2xl font-bold text-white">USDC Portfolio</h2>
          <p className="text-slate-400 text-sm">
            Your USDC balance across all four CCTP-connected chains, in one view.
          </p>
        </div>

        {!walletAddress ? (
          /* ── Connect prompt ── */
          <div className="bg-[#111827]/80 border border-white/[0.06] rounded-2xl p-10 flex flex-col items-center gap-4 text-center">
            <div className="w-12 h-12 rounded-2xl bg-white/[0.04] border border-white/[0.06] flex items-center justify-center">
              <Wallet className="w-5 h-5 text-slate-400" />
            </div>
            <div>
              <p className="text-white font-semibold">Connect your wallet</p>
              <p className="text-slate-500 text-sm mt-1">
                Connect MetaMask to see your USDC across Arc, Ethereum, Base, and Avalanche.
              </p>
            </div>
            <WalletButton
              address={walletAddress}
              chainId={walletChainId}
              onConnect={handleWalletConnect}
            />
          </div>
        ) : (
          <>
            {/* ── Total banner ── */}
            <div className="bg-gradient-to-r from-[#111827] to-[#0d1b2a] border border-[#4F9CF9]/20 rounded-2xl p-6 flex items-center justify-between gap-4">
              <div>
                <p className="text-xs text-slate-500 uppercase tracking-wider font-medium">Total USDC</p>
                {allLoaded ? (
                  <p className="text-4xl font-bold text-white mt-1 tabular-nums">
                    {fmtUsdcFull(totalRaw)}
                    <span className="text-lg font-normal text-slate-400 ml-2">USDC</span>
                  </p>
                ) : (
                  <div className="flex items-center gap-2 mt-1 text-slate-400">
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span className="text-sm">Fetching balances…</span>
                  </div>
                )}
                {lastRefresh && (
                  <p className="text-[10px] text-slate-600 mt-2">
                    Last updated {lastRefresh.toLocaleTimeString()}
                  </p>
                )}
              </div>
              <button
                onClick={() => walletAddress && void refreshBalances(walletAddress)}
                disabled={loading}
                className="p-2.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.07] border border-white/[0.06] text-slate-400 hover:text-white transition-all disabled:opacity-40"
              >
                <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
              </button>
            </div>

            {/* ── Chain cards ── */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {balances.map((entry) => (
                <ChainBalanceCard
                  key={entry.chain.id}
                  entry={entry}
                  isArc={!!entry.chain.isArc}
                  walletAddress={walletAddress}
                />
              ))}
            </div>

            {/* ── Consolidate prompt ── */}
            {allLoaded && totalRaw > 0n && (
              <div className="bg-[#111827]/60 border border-white/[0.06] rounded-2xl p-5 flex items-start gap-4">
                <div className="w-8 h-8 rounded-xl bg-[#4F9CF9]/10 border border-[#4F9CF9]/20 flex items-center justify-center flex-shrink-0">
                  <Globe className="w-4 h-4 text-[#4F9CF9]" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white">Consolidate to Arc</p>
                  <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                    Arc Testnet offers the highest yield (18.5% APY) and sub-second finality.
                    Use the Bridge to move USDC from any chain to Arc — select the source chain below.
                  </p>
                  <div className="flex flex-wrap gap-2 mt-3">
                    {PORTFOLIO_CHAINS.filter((c) => !c.isArc).map((c) => (
                      <a key={c.id} href={bridgeToArcUrl(c.id)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white/[0.04] hover:bg-[#4F9CF9]/10 border border-white/[0.06] hover:border-[#4F9CF9]/30 rounded-xl text-xs text-slate-300 hover:text-[#4F9CF9] transition-all">
                        {c.shortName} → Arc <ArrowRight className="w-3 h-3" />
                      </a>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* ── Circle Gateway callout ── */}
        <div className="bg-[#111827]/60 border border-white/[0.04] rounded-2xl p-5">
          <div className="flex items-start gap-3">
            <div className="w-6 h-6 rounded-full bg-[#0047AB]/20 flex items-center justify-center flex-shrink-0 mt-0.5">
              <span className="text-[10px] font-bold text-blue-400">◎</span>
            </div>
            <div>
              <p className="text-xs font-semibold text-white">
                Want production-grade Unified Balance?
              </p>
              <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                Circle's{" "}
                <a href="https://developers.circle.com/gateway"
                  target="_blank" rel="noopener noreferrer"
                  className="text-[#4F9CF9] hover:underline">
                  Gateway
                </a>{" "}
                and the{" "}
                <a href="https://www.npmjs.com/package/@circle-fin/unified-balance-kit"
                  target="_blank" rel="noopener noreferrer"
                  className="text-[#4F9CF9] hover:underline">
                  @circle-fin/unified-balance-kit
                </a>{" "}
                SDK aggregate USDC from multiple chains (including Solana) into a single instantly-spendable
                balance. See the{" "}
                <a href="/developers" className="text-[#4F9CF9] hover:underline">
                  Developers
                </a>{" "}
                page for integration details.
              </p>
            </div>
          </div>
        </div>

      </main>
    </div>
  );
}
