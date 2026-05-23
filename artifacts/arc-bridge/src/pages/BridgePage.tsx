import { useState, useEffect, useCallback, useRef } from "react";
import { ArrowDownUp, Info, RefreshCw, ExternalLink, Zap } from "lucide-react";
import { CHAINS, ChainConfig, getChainById } from "@/lib/chains";
import {
  BridgeStatus,
  ActiveStep,
  connectWallet,
  getWalletChainId,
  getUsdcBalance,
  switchToChain,
  executeBridge,
  friendlyError,
} from "@/lib/bridge";
import { calculateFee, formatUsdc, FEE_BPS, isFeeActive } from "@/lib/config";
import { WalletButton } from "@/components/WalletButton";
import { ChainSelector } from "@/components/ChainSelector";
import { StepProgress } from "@/components/StepProgress";
import { TxLink } from "@/components/TxLink";
import { cn } from "@/lib/utils";
import { ethers } from "ethers";

function safeParseBalance(balance: string): number | null {
  const n = parseFloat(balance);
  return isNaN(n) ? null : n;
}

export default function BridgePage() {
  const [fromChain, setFromChain] = useState<ChainConfig>(CHAINS.ETH_SEPOLIA);
  const [toChain, setToChain]     = useState<ChainConfig>(CHAINS.ARC_TESTNET);
  const [amount, setAmount]       = useState("");
  const [recipient, setRecipient] = useState("");
  const [useCustomRecipient, setUseCustomRecipient] = useState(false);

  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [walletChainId, setWalletChainId] = useState<number | null>(null);
  const [fromBalance, setFromBalance]     = useState<string>("—");
  const [toBalance, setToBalance]         = useState<string>("—");
  const [loadingBalances, setLoadingBalances] = useState(false);

  const [bridgeStatus, setBridgeStatus] = useState<BridgeStatus>({
    step: "idle",
    message: "",
  });

  const currentStepRef  = useRef<ActiveStep | null>(null);
  const lastBurnTxRef   = useRef<string | undefined>(undefined);
  const lastFeeTxRef    = useRef<string | undefined>(undefined);

  function handleWalletConnect(addr: string, chainId: number) {
    setWalletAddress(addr);
    setWalletChainId(chainId);
    setRecipient(addr);
  }

  const refreshBalances = useCallback(async () => {
    if (!walletAddress) return;
    setLoadingBalances(true);
    const [fb, tb] = await Promise.all([
      getUsdcBalance(walletAddress, fromChain),
      getUsdcBalance(walletAddress, toChain),
    ]);
    setFromBalance(fb);
    setToBalance(tb);
    setLoadingBalances(false);
  }, [walletAddress, fromChain, toChain]);

  useEffect(() => { refreshBalances(); }, [refreshBalances]);

  useEffect(() => {
    if (!window.ethereum) return;
    const handleChainChange = (chainIdHex: unknown) => {
      setWalletChainId(parseInt(chainIdHex as string, 16));
    };
    const handleAccountsChange = (accounts: unknown) => {
      const accs = accounts as string[];
      if (accs.length === 0) {
        setWalletAddress(null);
        setWalletChainId(null);
      } else {
        setWalletAddress(accs[0]);
        setRecipient(accs[0]);
      }
    };
    window.ethereum.request({ method: "eth_chainId" }).then((id) => {
      setWalletChainId(parseInt(id as string, 16));
    });
    window.ethereum.on?.("chainChanged", handleChainChange);
    window.ethereum.on?.("accountsChanged", handleAccountsChange);
    return () => {
      window.ethereum?.removeListener?.("chainChanged", handleChainChange);
      window.ethereum?.removeListener?.("accountsChanged", handleAccountsChange);
    };
  }, []);

  function swapChains() {
    setFromChain(toChain);
    setToChain(fromChain);
    setFromBalance(toBalance);
    setToBalance(fromBalance);
  }

  const wrongNetwork =
    walletAddress !== null &&
    walletChainId !== null &&
    walletChainId !== fromChain.id;

  async function handleSwitchNetwork() {
    try {
      await switchToChain(fromChain);
      const cid = await getWalletChainId();
      setWalletChainId(cid);
    } catch (e) {
      console.error("Failed to switch network:", e);
    }
  }

  async function handleConnect() {
    try {
      const addr = await connectWallet();
      const cid  = await getWalletChainId();
      handleWalletConnect(addr, cid);
    } catch (e) {
      console.error("Wallet connect failed:", e);
    }
  }

  async function handleBridge() {
    if (!walletAddress) return;
    const effectiveRecipient = useCustomRecipient ? recipient : walletAddress;
    const parsedAmount = parseFloat(amount);
    if (!amount || isNaN(parsedAmount) || parsedAmount <= 0) return;

    currentStepRef.current = null;
    lastBurnTxRef.current  = undefined;
    lastFeeTxRef.current   = undefined;
    setBridgeStatus({ step: "approving", message: "Starting bridge..." });

    try {
      await executeBridge(fromChain, toChain, amount, effectiveRecipient, (status) => {
        setBridgeStatus(status);
        // Track tx hashes so the error handler can preserve them if we throw later
        if (status.burnTxHash) lastBurnTxRef.current = status.burnTxHash;
        if (status.feeTxHash)  lastFeeTxRef.current  = status.feeTxHash;
        if (
          status.step === "approving"  ||
          status.step === "collecting" ||
          status.step === "burning"    ||
          status.step === "attesting"  ||
          status.step === "minting"
        ) {
          currentStepRef.current = status.step;
        }
      });
      await refreshBalances();
    } catch (err: unknown) {
      // Preserve any tx hashes already emitted — critical for attestation timeout recovery
      setBridgeStatus({
        step: "error",
        message: "Bridge failed",
        error: friendlyError(err),
        failedAtStep: currentStepRef.current ?? undefined,
        feeTxHash:    lastFeeTxRef.current,
        burnTxHash:   lastBurnTxRef.current,
      });
    }
  }

  function handleReset() {
    setBridgeStatus({ step: "idle", message: "" });
    setAmount("");
    currentStepRef.current = null;
  }

  const isProcessing =
    bridgeStatus.step !== "idle" &&
    bridgeStatus.step !== "done" &&
    bridgeStatus.step !== "error";

  const parsedAmount   = parseFloat(amount);
  const amountIsValid  = amount !== "" && !isNaN(parsedAmount) && parsedAmount > 0;
  const sameChain      = fromChain.id === toChain.id;
  const feeEnabled     = isFeeActive();

  // Live fee breakdown — computed from raw input
  const grossUnits = amountIsValid
    ? (() => { try { return ethers.parseUnits(amount.trim(), 6); } catch { return null; } })()
    : null;
  const feeBreakdown = grossUnits !== null ? calculateFee(grossUnits) : null;

  const canBridge =
    !!walletAddress &&
    amountIsValid &&
    !isProcessing &&
    !wrongNetwork &&
    !sameChain;

  const walletChain    = walletChainId ? getChainById(walletChainId) : null;
  const fromBalanceNum = safeParseBalance(fromBalance);

  function applyMaxBalance() {
    if (fromBalanceNum !== null) setAmount(fromBalanceNum.toFixed(6));
  }

  return (
    <div className="min-h-screen bg-[#0C1220] flex flex-col">

      {/* ── Header ── */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06]">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#354457] to-[#4F9CF9] flex items-center justify-center">
            <span className="text-white text-sm font-bold">⬡</span>
          </div>
          <div>
            <h1 className="text-white font-bold text-base leading-none">Arc Relay Bridge</h1>
            <p className="text-slate-500 text-[11px] mt-0.5">CCTP V2 · Cross-Chain USDC</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <a href="https://faucet.circle.com" target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-[#4F9CF9] transition-colors">
            Faucet <ExternalLink className="w-3 h-3" />
          </a>
          <a href="https://explorer.testnet.arc.network" target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-[#4F9CF9] transition-colors">
            Explorer <ExternalLink className="w-3 h-3" />
          </a>
          <WalletButton address={walletAddress} chainId={walletChainId} onConnect={handleWalletConnect} />
        </div>
      </header>

      {/* ── Main ── */}
      <main className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-md space-y-3">

          {/* ── Card ── */}
          <div className="bg-[#111827] border border-white/[0.07] rounded-2xl shadow-2xl overflow-hidden">

            {/* Card header */}
            <div className="px-6 pt-5 pb-4 border-b border-white/[0.06]">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-white font-bold text-lg">Bridge USDC</h2>
                  <p className="text-slate-400 text-xs mt-0.5">
                    Burn on source · Attest · Mint natively on destination
                  </p>
                </div>
                <button
                  onClick={refreshBalances}
                  disabled={loadingBalances || !walletAddress}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  title="Refresh balances"
                >
                  <RefreshCw className={cn("w-4 h-4", loadingBalances && "animate-spin")} />
                </button>
              </div>
            </div>

            <div className="p-6 space-y-4">

              {/* Wrong network banner */}
              {wrongNetwork && (
                <div className="flex items-center justify-between gap-3 px-4 py-3 bg-amber-500/10 border border-amber-500/30 rounded-xl">
                  <div className="flex items-start gap-2">
                    <Info className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
                    <p className="text-amber-300 text-xs">
                      Wallet is on{" "}
                      <span className="font-semibold">{walletChain?.name ?? `chain ${walletChainId}`}</span>.
                      Switch to <span className="font-semibold">{fromChain.name}</span> to proceed.
                    </p>
                  </div>
                  <button onClick={handleSwitchNetwork}
                    className="text-xs font-semibold text-amber-300 border border-amber-500/40 px-3 py-1.5 rounded-lg hover:bg-amber-500/10 transition-all whitespace-nowrap">
                    Switch
                  </button>
                </div>
              )}

              {/* Same-chain warning */}
              {sameChain && (
                <div className="flex items-center gap-2 px-4 py-3 bg-red-500/10 border border-red-500/30 rounded-xl">
                  <Info className="w-4 h-4 text-red-400 flex-shrink-0" />
                  <p className="text-red-300 text-xs">Source and destination chains must be different.</p>
                </div>
              )}

              {/* From chain */}
              <div className="space-y-2">
                <ChainSelector label="From" selected={fromChain} exclude={toChain}
                  onChange={(c) => setFromChain(c)} disabled={isProcessing} />
                {walletAddress && (
                  <div className="flex items-center justify-between px-1">
                    <span className="text-xs text-slate-500">Balance</span>
                    <button onClick={applyMaxBalance}
                      disabled={fromBalanceNum === null || isProcessing}
                      className="text-xs text-[#4F9CF9] hover:text-[#7BB8FB] font-mono transition-colors disabled:text-slate-500 disabled:cursor-default">
                      {fromBalance} USDC
                    </button>
                  </div>
                )}
              </div>

              {/* Amount input */}
              <div className="relative">
                <input
                  type="number" value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00" min="0" step="0.01" disabled={isProcessing}
                  className={cn(
                    "w-full px-4 py-3.5 pr-20 rounded-xl text-white text-xl font-semibold",
                    "bg-slate-800/80 border border-slate-700/60 focus:border-[#4F9CF9]/60 focus:outline-none",
                    "placeholder:text-slate-600 transition-colors disabled:opacity-50",
                    "[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  )}
                />
                <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-2">
                  <button onClick={applyMaxBalance}
                    disabled={fromBalanceNum === null || !walletAddress || isProcessing}
                    className="text-xs font-semibold text-[#4F9CF9] hover:text-[#7BB8FB] disabled:text-slate-600 disabled:cursor-not-allowed transition-colors">
                    MAX
                  </button>
                  <span className="text-slate-400 text-sm font-medium">USDC</span>
                </div>
              </div>

              {/* Swap chains */}
              <div className="flex justify-center -my-1">
                <button onClick={swapChains} disabled={isProcessing}
                  title="Swap source and destination"
                  className={cn(
                    "p-2.5 rounded-full border border-slate-700 bg-slate-800 text-slate-400",
                    "hover:border-[#4F9CF9]/40 hover:text-[#4F9CF9] hover:bg-slate-700 transition-all",
                    "disabled:opacity-40 disabled:cursor-not-allowed"
                  )}>
                  <ArrowDownUp className="w-4 h-4" />
                </button>
              </div>

              {/* To chain */}
              <div className="space-y-2">
                <ChainSelector label="To" selected={toChain} exclude={fromChain}
                  onChange={(c) => setToChain(c)} disabled={isProcessing} />
                {walletAddress && (
                  <div className="flex items-center justify-between px-1">
                    <span className="text-xs text-slate-500">Balance</span>
                    <span className="text-xs text-slate-400 font-mono">{toBalance} USDC</span>
                  </div>
                )}
              </div>

              {/* Custom recipient */}
              <div>
                <button onClick={() => setUseCustomRecipient(!useCustomRecipient)}
                  disabled={isProcessing}
                  className="text-xs text-slate-500 hover:text-slate-300 transition-colors disabled:cursor-not-allowed">
                  {useCustomRecipient ? "▼" : "▶"} Send to different address
                </button>
                {useCustomRecipient && (
                  <input type="text" value={recipient}
                    onChange={(e) => setRecipient(e.target.value)}
                    placeholder="0x… recipient address on destination chain"
                    disabled={isProcessing}
                    className={cn(
                      "mt-2 w-full px-3 py-2.5 rounded-xl text-sm font-mono text-white",
                      "bg-slate-800/80 border border-slate-700/60 focus:border-[#4F9CF9]/60 focus:outline-none",
                      "placeholder:text-slate-600 transition-colors disabled:opacity-50"
                    )}
                  />
                )}
              </div>

              {/* ── Fee & Bridge Summary ── */}
              {amountIsValid && !sameChain && feeBreakdown && (
                <div className="px-4 py-3 bg-slate-800/40 rounded-xl border border-slate-700/40 space-y-2">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-500">You send</span>
                    <span className="text-white font-medium">{amount} USDC</span>
                  </div>

                  {feeBreakdown.active ? (
                    <>
                      <div className="flex justify-between text-xs">
                        <span className="flex items-center gap-1 text-slate-500">
                          <Zap className="w-3 h-3 text-[#4F9CF9]" />
                          Protocol fee ({FEE_BPS / 100}%)
                        </span>
                        <span className="text-slate-300 font-mono">
                          −{formatUsdc(feeBreakdown.feeAmount)} USDC
                        </span>
                      </div>
                      <div className="border-t border-slate-700/60 pt-2 flex justify-between text-xs">
                        <span className="text-slate-500">You receive</span>
                        <span className="text-emerald-400 font-semibold">
                          {formatUsdc(feeBreakdown.bridgeAmount)} USDC
                        </span>
                      </div>
                    </>
                  ) : (
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-500">You receive</span>
                      <span className="text-emerald-400 font-medium">{amount} USDC</span>
                    </div>
                  )}

                  <div className="flex justify-between text-xs">
                    <span className="text-slate-500">Protocol</span>
                    <span className="text-slate-300">Circle CCTP V2</span>
                  </div>
                </div>
              )}

              {/* ── Status / Progress ── */}
              {bridgeStatus.step !== "idle" && (
                <div className="space-y-4 px-4 py-4 bg-slate-800/30 rounded-xl border border-slate-700/40">
                  <StepProgress
                    step={bridgeStatus.step}
                    failedAtStep={bridgeStatus.failedAtStep}
                    hasFee={feeEnabled}
                  />

                  {/* Status message — special layout for attestation timeout */}
                  {bridgeStatus.step === "error" && bridgeStatus.error?.startsWith("Attestation timed out") ? (
                    <div className="space-y-2">
                      <p className="text-xs text-red-400 text-center font-medium">
                        Attestation timed out — but your funds are safe.
                      </p>
                      <p className="text-xs text-slate-400 text-center leading-relaxed">
                        The burn is confirmed on-chain. Circle will eventually produce the attestation.
                        You can retry the mint step manually once it appears using the burn tx below.
                      </p>
                      {bridgeStatus.burnTxHash && (
                        <div className="flex items-center justify-between px-3 py-2 bg-slate-800/60 rounded-lg border border-slate-700/50">
                          <span className="text-xs text-slate-500">Burn tx (save this)</span>
                          <TxLink hash={bridgeStatus.burnTxHash} chain={fromChain} />
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className={cn(
                      "text-xs text-center leading-relaxed",
                      bridgeStatus.step === "done"  && "text-emerald-400 font-medium",
                      bridgeStatus.step === "error" && "text-red-400",
                      bridgeStatus.step !== "done" && bridgeStatus.step !== "error" && "text-slate-400"
                    )}>
                      {bridgeStatus.error ?? bridgeStatus.message}
                    </p>
                  )}

                  {/* TX links */}
                  <div className="flex flex-col gap-1.5">
                    {bridgeStatus.feeTxHash && (
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-slate-500">Fee tx</span>
                        <TxLink hash={bridgeStatus.feeTxHash} chain={fromChain} />
                      </div>
                    )}
                    {bridgeStatus.burnTxHash && (
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-slate-500">Burn tx</span>
                        <TxLink hash={bridgeStatus.burnTxHash} chain={fromChain} />
                      </div>
                    )}
                    {bridgeStatus.mintTxHash && (
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-slate-500">Mint tx</span>
                        <TxLink hash={bridgeStatus.mintTxHash} chain={toChain} />
                      </div>
                    )}
                  </div>

                  {(bridgeStatus.step === "done" || bridgeStatus.step === "error") && (
                    <button onClick={handleReset}
                      className="w-full py-2 text-xs font-semibold text-slate-400 hover:text-white border border-slate-700 hover:border-slate-500 rounded-xl transition-all">
                      Start new transfer
                    </button>
                  )}
                </div>
              )}

              {/* ── CTA ── */}
              {bridgeStatus.step === "idle" && (
                <>
                  {!walletAddress ? (
                    <button onClick={handleConnect}
                      className="w-full py-3.5 rounded-xl font-semibold text-sm bg-[#4F9CF9] hover:bg-[#3B8AE8] text-white transition-all duration-150">
                      Connect Wallet
                    </button>
                  ) : wrongNetwork ? (
                    <button onClick={handleSwitchNetwork}
                      className="w-full py-3.5 rounded-xl font-semibold text-sm bg-amber-500 hover:bg-amber-400 text-white transition-all duration-150">
                      Switch to {fromChain.name}
                    </button>
                  ) : (
                    <button onClick={handleBridge} disabled={!canBridge}
                      className={cn(
                        "w-full py-3.5 rounded-xl font-semibold text-sm transition-all duration-150",
                        canBridge
                          ? "bg-[#4F9CF9] hover:bg-[#3B8AE8] text-white shadow-lg shadow-[#4F9CF9]/20"
                          : "bg-slate-700 text-slate-500 cursor-not-allowed"
                      )}>
                      {sameChain      ? "Select different chains" :
                       !amountIsValid ? "Enter an amount"         :
                                        "Bridge USDC"}
                    </button>
                  )}
                </>
              )}
            </div>
          </div>

          {/* ── Fee notice / setup prompt ── */}
          {feeEnabled ? (
            <div className="px-4 py-3 bg-[#111827]/60 border border-[#4F9CF9]/10 rounded-xl">
              <div className="flex items-start gap-2">
                <Zap className="w-3.5 h-3.5 text-[#4F9CF9] mt-0.5 flex-shrink-0" />
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  A <span className="text-slate-400 font-medium">{FEE_BPS / 100}% protocol fee</span> is
                  collected on each bridge transfer — deducted from the sent amount on the source chain
                  before bridging.
                </p>
              </div>
            </div>
          ) : (
            <div className="px-4 py-3 bg-[#111827]/60 border border-amber-500/10 rounded-xl">
              <div className="flex items-start gap-2">
                <Info className="w-3.5 h-3.5 text-amber-500/70 mt-0.5 flex-shrink-0" />
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Fee collection is inactive.{" "}
                  Set the <span className="text-slate-400 font-mono">VITE_FEE_RECIPIENT</span> secret
                  to your wallet address to start earning a{" "}
                  <span className="text-slate-400">{FEE_BPS / 100}% protocol fee</span> on each transfer.
                </p>
              </div>
            </div>
          )}

          {/* ── Info footer ── */}
          <div className="px-4 py-3 bg-[#111827]/60 border border-white/[0.05] rounded-xl">
            <div className="flex items-start gap-2">
              <Info className="w-3.5 h-3.5 text-slate-500 mt-0.5 flex-shrink-0" />
              <p className="text-[11px] text-slate-500 leading-relaxed">
                Uses Circle CCTP V2 — USDC is burned on source and natively minted on destination.
                Arc Testnet CCTP Domain: <span className="text-slate-400 font-mono">7</span>.
                Get testnet USDC from the{" "}
                <a href="https://faucet.circle.com" target="_blank" rel="noopener noreferrer"
                  className="text-[#4F9CF9] hover:underline">Circle Faucet</a>.
              </p>
            </div>
          </div>

          {/* ── Chain pills ── */}
          <div className="grid grid-cols-2 gap-2">
            <a href="https://explorer.testnet.arc.network" target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-2 px-3 py-2 bg-[#111827]/60 border border-white/[0.05] rounded-xl hover:border-[#4F9CF9]/30 transition-all group">
              <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0"
                style={{ background: CHAINS.ARC_TESTNET.logoColor }}>⬡</span>
              <div className="min-w-0">
                <div className="text-xs text-white font-medium truncate">Arc Testnet</div>
                <div className="text-[10px] text-slate-500">Chain ID 5042002</div>
              </div>
              <ExternalLink className="w-3 h-3 text-slate-600 group-hover:text-[#4F9CF9] ml-auto transition-colors" />
            </a>
            <a href="https://developers.circle.com/stablecoins/cctp-getting-started" target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-2 px-3 py-2 bg-[#111827]/60 border border-white/[0.05] rounded-xl hover:border-[#4F9CF9]/30 transition-all group">
              <span className="w-5 h-5 rounded-full bg-[#0047AB] flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0">◎</span>
              <div className="min-w-0">
                <div className="text-xs text-white font-medium truncate">CCTP V2</div>
                <div className="text-[10px] text-slate-500">Circle Protocol</div>
              </div>
              <ExternalLink className="w-3 h-3 text-slate-600 group-hover:text-[#4F9CF9] ml-auto transition-colors" />
            </a>
          </div>
        </div>
      </main>
    </div>
  );
}
