import { useState, useEffect, useCallback, useRef } from "react";
import {
  Fuel, ArrowRight, CheckCircle2, AlertCircle, ExternalLink,
  RefreshCw, Loader2, Wallet, Droplets,
} from "lucide-react";
import { ethers } from "ethers";
import { CHAINS, USDC_ABI } from "@/lib/chains";
import { connectWallet, switchToChain } from "@/lib/bridge";
import {
  fetchRefuelQuote, submitRefuel, fetchLiquidity,
  usdcToUnits, unitsToUsdc,
  type GasRefuelQuote, type GasRefuelResult, type LiquidityEntry,
} from "@/lib/gasRefuel";
import { WalletButton } from "@/components/WalletButton";
import { cn } from "@/lib/utils";

// ── Destination chain configs (display only) ─────────────────────────────────
const DEST_CHAINS = [
  {
    ...CHAINS.ETH_SEPOLIA,
    logoColor: "#627EEA",
  },
  {
    ...CHAINS.BASE_SEPOLIA,
    logoColor: "#0052FF",
  },
  {
    ...CHAINS.AVAX_FUJI,
    logoColor: "#E84142",
  },
] as const;

type DestChain = (typeof DEST_CHAINS)[number];

const MIN_USDC = 0.5;
const MAX_USDC = 10;
const QUOTE_TTL_MS = 2 * 60 * 1000;

// ── Helpers ───────────────────────────────────────────────────────────────────

function clamp(n: number, min: number, max: number) {
  return Math.min(Math.max(n, min), max);
}

function ChainDot({ color }: { color: string }) {
  return (
    <span
      className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
      style={{ background: color }}
    />
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function RefuelPage() {
  // Wallet
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [walletChainId, setWalletChainId] = useState<number | null>(null);
  const [usdcBalance, setUsdcBalance] = useState<bigint | null>(null);

  // UI state
  const [selectedChain, setSelectedChain] = useState<DestChain>(DEST_CHAINS[0]);
  const [amountStr, setAmountStr] = useState("1");
  const [quote, setQuote] = useState<GasRefuelQuote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [quoteExpired, setQuoteExpired] = useState(false);

  // Liquidity
  const [liquidity, setLiquidity] = useState<LiquidityEntry[]>([]);

  // Flow state
  type Step = "idle" | "transferring" | "submitting" | "done" | "error";
  const [step, setStep] = useState<Step>("idle");
  const [arcTxHash, setArcTxHash] = useState<string | null>(null);
  const [result, setResult] = useState<GasRefuelResult | null>(null);
  const [flowError, setFlowError] = useState<string | null>(null);

  const quoteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Wallet ──────────────────────────────────────────────────────────────────

  const handleWalletConnect = useCallback(
    async (addr: string, chainId: number) => {
      setWalletAddress(addr);
      setWalletChainId(chainId);
      // Read USDC balance on Arc Testnet
      try {
        const arcRpc = CHAINS.ARC_TESTNET.rpcUrl;
        const provider = new ethers.JsonRpcProvider(arcRpc);
        const usdc = new ethers.Contract(CHAINS.ARC_TESTNET.usdcAddress, USDC_ABI, provider);
        const bal: bigint = await usdc.balanceOf(addr);
        setUsdcBalance(bal);
      } catch {
        setUsdcBalance(null);
      }
    },
    []
  );

  // ── Liquidity ───────────────────────────────────────────────────────────────

  useEffect(() => {
    fetchLiquidity()
      .then((d) => setLiquidity(d.liquidity))
      .catch(() => {/* silent — liquidity is informational */});
  }, []);

  function liquidityFor(chainId: number): LiquidityEntry | undefined {
    return liquidity.find((l) => l.chainId === chainId);
  }

  // ── Quote ───────────────────────────────────────────────────────────────────

  const fetchQuote = useCallback(async (chain: DestChain, amount: string) => {
    const n = parseFloat(amount);
    if (!isFinite(n) || n < MIN_USDC || n > MAX_USDC) {
      setQuote(null);
      setQuoteError(null);
      return;
    }

    const units = usdcToUnits(amount);
    setQuoteLoading(true);
    setQuoteError(null);
    setQuoteExpired(false);
    if (quoteTimerRef.current) clearTimeout(quoteTimerRef.current);

    try {
      const q = await fetchRefuelQuote(chain.id, units);
      setQuote(q);

      // Mark quote expired after TTL
      const remaining = q.validUntil - Date.now();
      if (remaining > 0) {
        quoteTimerRef.current = setTimeout(() => setQuoteExpired(true), remaining);
      }
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : typeof err === "object" && err !== null && "message" in err
            ? String((err as { message: unknown }).message)
            : String(err);
      setQuoteError(msg);
      setQuote(null);
    } finally {
      setQuoteLoading(false);
    }
  }, []);

  // Debounced re-fetch when chain or amount changes
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void fetchQuote(selectedChain, amountStr);
    }, 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [selectedChain, amountStr, fetchQuote]);

  // ── Send flow ───────────────────────────────────────────────────────────────

  async function handleSend() {
    if (!walletAddress || !quote) return;

    setStep("transferring");
    setFlowError(null);
    setArcTxHash(null);
    setResult(null);

    try {
      // Switch to Arc Testnet if needed (try switch first, add only if unknown)
      if (walletChainId !== CHAINS.ARC_TESTNET.id) {
        await switchToChain(CHAINS.ARC_TESTNET);
        await new Promise((r) => setTimeout(r, 800));
      }

      const provider = new ethers.BrowserProvider(window.ethereum as ethers.Eip1193Provider);
      const signer = await provider.getSigner();
      const usdc = new ethers.Contract(CHAINS.ARC_TESTNET.usdcAddress, USDC_ABI, signer);
      const amount = BigInt(quote.usdcAmount);

      const tx = await (usdc.transfer as (to: string, amount: bigint) => Promise<ethers.TransactionResponse>)(
        quote.depositAddress,
        amount
      );

      setArcTxHash(tx.hash);
      setStep("submitting");

      // Wait for 1 confirmation
      await tx.wait(1);

      // Submit to refuel API
      const res = await submitRefuel(tx.hash, selectedChain.id, walletAddress);
      setResult(res);
      setStep("done");

      // Refresh USDC balance
      try {
        const arcProvider = new ethers.JsonRpcProvider(CHAINS.ARC_TESTNET.rpcUrl);
        const usdcRead = new ethers.Contract(CHAINS.ARC_TESTNET.usdcAddress, USDC_ABI, arcProvider);
        const bal: bigint = await usdcRead.balanceOf(walletAddress);
        setUsdcBalance(bal);
      } catch {/* balance refresh is best-effort */}
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : typeof err === "object" && err !== null && "message" in err
            ? String((err as { message: unknown }).message)
            : String(err);
      setFlowError(msg.slice(0, 200));
      setStep("error");
    }
  }

  function handleReset() {
    setStep("idle");
    setFlowError(null);
    setArcTxHash(null);
    setResult(null);
    void fetchQuote(selectedChain, amountStr);
  }

  // ── Amount input helpers ─────────────────────────────────────────────────────

  const parsedAmount = parseFloat(amountStr);
  const amountValid = isFinite(parsedAmount) && parsedAmount >= MIN_USDC && parsedAmount <= MAX_USDC;
  const usdcUnits = amountValid ? usdcToUnits(amountStr) : "0";
  const usdcBalanceFormatted = usdcBalance !== null
    ? (Number(usdcBalance) / 1e6).toFixed(2)
    : null;
  const canSend =
    !!walletAddress &&
    amountValid &&
    !!quote &&
    !quoteExpired &&
    quote.sufficient &&
    step === "idle";

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#0a0f1a] text-white flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-white/5">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-orange-500/20 flex items-center justify-center">
            <Fuel className="w-4 h-4 text-orange-400" />
          </div>
          <div>
            <div className="font-bold text-base text-white leading-tight">Gas Refuel</div>
            <div className="text-xs text-white/40 hidden sm:block">
              Spend Arc USDC · receive native gas anywhere
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <a href="/" className="text-sm text-white/50 hover:text-white transition-colors hidden sm:block">
            ← Bridge
          </a>
          <a href="/paymaster" className="text-sm text-white/50 hover:text-white transition-colors hidden sm:block">
            Paymaster →
          </a>
          <a href="/yield" className="text-sm text-white/50 hover:text-white transition-colors hidden sm:block">
            Yield →
          </a>
          <WalletButton
            address={walletAddress}
            chainId={walletChainId}
            onConnect={(addr, chainId) => void handleWalletConnect(addr, chainId)}
          />
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 flex items-start justify-center p-4 pt-8">
        <div className="w-full max-w-md flex flex-col gap-4">

          {/* How it works */}
          <div className="rounded-2xl border border-orange-500/20 bg-orange-500/5 px-5 py-4 flex gap-3">
            <Droplets className="w-4 h-4 text-orange-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-white/60 leading-relaxed">
              Send USDC from your Arc Testnet wallet to the refuel address.
              We'll instantly send native gas (ETH or AVAX) to your wallet
              on the destination chain at the live market price — no bridging required.
            </p>
          </div>

          {/* Main card */}
          <div className="rounded-2xl border border-white/10 bg-white/5 p-5 flex flex-col gap-5">

            {/* ── Destination chain selector ─────────────────────────── */}
            <div>
              <label className="text-xs text-white/40 uppercase tracking-wider font-medium mb-2 block">
                Receive gas on
              </label>
              <div className="grid grid-cols-3 gap-2">
                {DEST_CHAINS.map((c) => {
                  const liq = liquidityFor(c.id);
                  const hasLiq = liq?.balance && BigInt(liq.balance) > 0n;
                  return (
                    <button
                      key={c.id}
                      onClick={() => setSelectedChain(c)}
                      className={cn(
                        "relative rounded-xl border px-3 py-3 flex flex-col items-center gap-1.5 transition-all duration-150",
                        selectedChain.id === c.id
                          ? "border-orange-500/60 bg-orange-500/10 shadow-lg shadow-orange-900/10"
                          : "border-white/10 bg-white/3 hover:border-white/20 hover:bg-white/6"
                      )}
                    >
                      <ChainDot color={c.logoColor} />
                      <span className="text-[11px] font-semibold text-white/90 text-center leading-tight">
                        {c.shortName}
                      </span>
                      <span className="text-[10px] text-white/40">
                        {c.nativeCurrency.symbol}
                      </span>
                      {hasLiq && (
                        <span className="absolute -top-1.5 -right-1.5 w-3 h-3 rounded-full bg-emerald-400 border border-[#0a0f1a]" title="Liquidity available" />
                      )}
                    </button>
                  );
                })}
              </div>
              {/* Liquidity display */}
              {(() => {
                const liq = liquidityFor(selectedChain.id);
                if (!liq) return null;
                return (
                  <p className="mt-2 text-xs text-white/30">
                    Relayer balance on {selectedChain.shortName}:{" "}
                    {liq.balanceFormatted
                      ? `${liq.balanceFormatted} ${liq.symbol}`
                      : liq.error
                      ? "unavailable"
                      : "—"}
                  </p>
                );
              })()}
            </div>

            {/* ── USDC amount ────────────────────────────────────────── */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs text-white/40 uppercase tracking-wider font-medium">
                  USDC to spend (Arc Testnet)
                </label>
                {usdcBalanceFormatted !== null && (
                  <button
                    className="text-xs text-orange-400/70 hover:text-orange-400 transition-colors"
                    onClick={() => {
                      const maxVal = Math.min(
                        parseFloat(usdcBalanceFormatted),
                        MAX_USDC
                      );
                      setAmountStr(String(clamp(maxVal, MIN_USDC, MAX_USDC)));
                    }}
                  >
                    Balance: {usdcBalanceFormatted} USDC
                  </button>
                )}
              </div>
              <div className="relative">
                <input
                  type="number"
                  min={MIN_USDC}
                  max={MAX_USDC}
                  step="0.5"
                  value={amountStr}
                  onChange={(e) => setAmountStr(e.target.value)}
                  className={cn(
                    "w-full rounded-xl border bg-black/30 px-4 py-3 text-white text-lg font-semibold",
                    "placeholder-white/20 focus:outline-none focus:ring-1 transition-colors",
                    amountValid
                      ? "border-white/20 focus:border-orange-500/60 focus:ring-orange-500/20"
                      : "border-red-500/40 focus:border-red-500/60 focus:ring-red-500/20"
                  )}
                  placeholder="1.0"
                  disabled={step !== "idle"}
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-white/40 font-medium">
                  USDC
                </span>
              </div>
              <div className="flex items-center justify-between mt-1.5">
                <p className="text-xs text-white/30">Min {MIN_USDC} · Max {MAX_USDC} USDC</p>
                {!amountValid && amountStr !== "" && (
                  <p className="text-xs text-red-400">
                    {parsedAmount < MIN_USDC ? `Min ${MIN_USDC} USDC` : `Max ${MAX_USDC} USDC`}
                  </p>
                )}
              </div>
            </div>

            {/* ── Quote panel ────────────────────────────────────────── */}
            <div className={cn(
              "rounded-xl border px-4 py-3.5 min-h-[80px] flex flex-col justify-center transition-all",
              quote && !quoteExpired
                ? "border-orange-500/30 bg-orange-500/5"
                : "border-white/8 bg-black/20"
            )}>
              {quoteLoading ? (
                <div className="flex items-center gap-2 text-white/40 text-sm">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Fetching live price…
                </div>
              ) : quoteError ? (
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-red-400">{quoteError}</p>
                </div>
              ) : quoteExpired ? (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-amber-400">Quote expired</span>
                  <button
                    onClick={() => void fetchQuote(selectedChain, amountStr)}
                    className="flex items-center gap-1.5 text-xs text-orange-400 hover:text-orange-300 transition-colors"
                  >
                    <RefreshCw className="w-3 h-3" />
                    Refresh
                  </button>
                </div>
              ) : quote ? (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-white/50">You receive on {selectedChain.shortName}</span>
                    <div className="flex items-center gap-1.5">
                      <ChainDot color={selectedChain.logoColor} />
                      <span className="text-lg font-bold text-white tabular-nums">
                        {quote.nativeAmountFormatted}
                      </span>
                      <span className="text-sm text-white/60 font-medium">{quote.nativeSymbol}</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-xs text-white/30">
                    <span>{quote.serviceFeePercent}% service fee included</span>
                    {!quote.sufficient && (
                      <span className="text-amber-400 flex items-center gap-1">
                        <AlertCircle className="w-3 h-3" />
                        Low liquidity
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-white/20">
                    <span>
                      Quote valid for{" "}
                      {Math.max(0, Math.round((quote.validUntil - Date.now()) / 1000))}s
                    </span>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-white/20">Enter an amount to see a quote</p>
              )}
            </div>

            {/* ── Action area ────────────────────────────────────────── */}
            {step === "idle" && (
              <>
                {!walletAddress ? (
                  <button
                    onClick={() => void connectWallet().then(async (address) => {
                      const chainIdHex = await (window.ethereum as { request: (a: { method: string }) => Promise<string> }).request({ method: "eth_chainId" });
                      await handleWalletConnect(address, parseInt(chainIdHex, 16));
                    })}
                    className="w-full flex items-center justify-center gap-2 rounded-xl bg-orange-600 hover:bg-orange-500 text-white font-semibold py-3.5 transition-colors"
                  >
                    <Wallet className="w-4 h-4" />
                    Connect Wallet
                  </button>
                ) : (
                  <button
                    onClick={() => void handleSend()}
                    disabled={!canSend}
                    className={cn(
                      "w-full flex items-center justify-center gap-2 rounded-xl font-semibold py-3.5 transition-all",
                      canSend
                        ? "bg-orange-600 hover:bg-orange-500 text-white shadow-lg shadow-orange-900/30"
                        : "bg-white/5 text-white/20 cursor-not-allowed"
                    )}
                  >
                    <Fuel className="w-4 h-4" />
                    Send USDC &amp; Refuel
                    {quote && <ArrowRight className="w-4 h-4" />}
                  </button>
                )}

                {!quote?.sufficient && quote && (
                  <p className="text-center text-xs text-amber-400/80">
                    Insufficient {selectedChain.nativeCurrency.symbol} in relayer on {selectedChain.shortName}.
                    Try a smaller amount or try again later.
                  </p>
                )}
              </>
            )}

            {/* ── In-progress states ─────────────────────────────────── */}
            {(step === "transferring" || step === "submitting") && (
              <div className="rounded-xl border border-orange-500/30 bg-orange-500/5 px-4 py-4 flex flex-col gap-3">
                <div className={cn(
                  "flex items-center gap-3",
                  step === "transferring" ? "text-white" : "text-white/40"
                )}>
                  {step === "transferring" ? (
                    <Loader2 className="w-4 h-4 animate-spin text-orange-400 flex-shrink-0" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                  )}
                  <div>
                    <p className="text-sm font-medium">Step 1 — Transfer USDC on Arc</p>
                    {arcTxHash && (
                      <a
                        href={`${CHAINS.ARC_TESTNET.explorerUrl}/tx/${arcTxHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-orange-400 hover:text-orange-300 flex items-center gap-1 mt-0.5"
                      >
                        {arcTxHash.slice(0, 10)}…{arcTxHash.slice(-6)}
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                </div>
                <div className={cn(
                  "flex items-center gap-3",
                  step === "submitting" ? "text-white" : "text-white/30"
                )}>
                  {step === "submitting" ? (
                    <Loader2 className="w-4 h-4 animate-spin text-orange-400 flex-shrink-0" />
                  ) : (
                    <div className="w-4 h-4 rounded-full border border-white/20 flex-shrink-0" />
                  )}
                  <p className="text-sm font-medium">Step 2 — Sending {selectedChain.nativeCurrency.symbol} to your wallet</p>
                </div>
              </div>
            )}

            {/* ── Done ──────────────────────────────────────────────── */}
            {step === "done" && result && (
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-4 flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0" />
                  <p className="font-semibold text-emerald-300">Refuel complete!</p>
                </div>
                <div className="flex items-center justify-between py-2 border-y border-white/8">
                  <span className="text-sm text-white/50">Received on {result.destChain}</span>
                  <div className="flex items-center gap-1.5">
                    <ChainDot color={selectedChain.logoColor} />
                    <span className="text-lg font-bold tabular-nums text-white">
                      {result.nativeAmountFormatted}
                    </span>
                    <span className="text-sm text-white/60">{result.nativeSymbol}</span>
                  </div>
                </div>
                <div className="flex flex-col gap-1.5 text-xs">
                  <div className="flex items-center justify-between text-white/40">
                    <span>USDC spent</span>
                    <span>{result.usdcUsedFormatted} USDC</span>
                  </div>
                  {arcTxHash && (
                    <div className="flex items-center justify-between">
                      <span className="text-white/40">Arc transfer</span>
                      <a
                        href={`${CHAINS.ARC_TESTNET.explorerUrl}/tx/${arcTxHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-orange-400 hover:text-orange-300 flex items-center gap-1"
                      >
                        {arcTxHash.slice(0, 8)}…{arcTxHash.slice(-6)}
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-white/40">Fulfillment tx</span>
                    <a
                      href={result.explorerUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-emerald-400 hover:text-emerald-300 flex items-center gap-1"
                    >
                      {result.fulfillmentTxHash.slice(0, 8)}…{result.fulfillmentTxHash.slice(-6)}
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                </div>
                <button
                  onClick={handleReset}
                  className="mt-1 w-full rounded-xl bg-white/5 hover:bg-white/10 text-white/70 hover:text-white text-sm font-medium py-2.5 transition-colors"
                >
                  Refuel again
                </button>
              </div>
            )}

            {/* ── Error ────────────────────────────────────────────── */}
            {step === "error" && (
              <div className="rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-4 flex flex-col gap-3">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-red-300">{flowError}</p>
                </div>
                <button
                  onClick={handleReset}
                  className="w-full rounded-xl bg-white/5 hover:bg-white/10 text-white/70 hover:text-white text-sm font-medium py-2.5 transition-colors"
                >
                  Try again
                </button>
              </div>
            )}
          </div>

          {/* Info footer */}
          <div className="rounded-2xl border border-white/5 bg-white/3 px-5 py-4 flex flex-col gap-2">
            <p className="text-xs font-semibold text-white/30 uppercase tracking-wider">How it works</p>
            <div className="flex flex-col gap-2">
              {[
                { n: "1", text: "Select destination chain and USDC amount (0.5–10 USDC)" },
                { n: "2", text: "Send USDC to the refuel address on Arc Testnet" },
                { n: "3", text: "We detect your transfer and send native gas to your wallet on the destination chain" },
              ].map((s) => (
                <div key={s.n} className="flex items-start gap-3">
                  <span className="w-5 h-5 rounded-full bg-orange-500/20 text-orange-400 text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                    {s.n}
                  </span>
                  <p className="text-xs text-white/40">{s.text}</p>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-white/20 mt-1">
              Prices from CoinGecko · 5% service fee · Testnet only
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
