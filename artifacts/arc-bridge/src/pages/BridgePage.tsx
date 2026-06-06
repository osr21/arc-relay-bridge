import { useState, useEffect, useCallback, useRef } from "react";
import { ArrowDownUp, Info, RefreshCw, ExternalLink, Zap, RotateCcw, Clock, ChevronDown, ChevronUp } from "lucide-react";
import { CHAINS, ChainConfig, getChainById } from "@/lib/chains";
import {
  BridgeStatus,
  ActiveStep,
  connectWallet,
  getWalletChainId,
  getUsdcBalance,
  switchToChain,
  executeBridge,
  resumeBridge,
  resumeBridgeGasRelay,
  friendlyError,
  addUsdcToWallet,
  GAS_RELAY_FEE_UNITS,
} from "@/lib/bridge";
import { calculateFee, formatUsdc, FEE_BPS, isFeeActive } from "@/lib/config";
import { BridgeSession, saveSession, loadSession, clearSession } from "@/lib/session";
import { BridgeHistoryEntry, saveBridgeHistory, loadBridgeHistory } from "@/lib/history";
import { isAASupported } from "@/lib/aa";
import { executeBridgeGasless, getSmartAccountAddress } from "@/lib/gaslessBridge";
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
  const [useGasRelay, setUseGasRelay] = useState(false);
  const [useGasless, setUseGasless]   = useState(false);

  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [walletChainId, setWalletChainId] = useState<number | null>(null);
  const [fromBalance, setFromBalance]     = useState<string>("—");
  const [toBalance, setToBalance]         = useState<string>("—");
  const [loadingBalances, setLoadingBalances] = useState(false);
  const [saWalletBalance, setSaWalletBalance] = useState<string>("—");
  const [saAddress, setSaAddress]             = useState<string | null>(null);
  const [saAddressCopied, setSaAddressCopied] = useState(false);
  const [oraclePrice, setOraclePrice]     = useState<string | null>(null);

  const [bridgeStatus, setBridgeStatus] = useState<BridgeStatus>({
    step: "idle",
    message: "",
  });
  const [resumeSession, setResumeSession] = useState<BridgeSession | null>(null);

  const currentStepRef     = useRef<ActiveStep | null>(null);
  const lastBurnTxRef      = useRef<string | undefined>(undefined);
  const lastFeeTxRef       = useRef<string | undefined>(undefined);
  const lastMintTxRef      = useRef<string | undefined>(undefined);
  const attestingStartRef  = useRef<number | null>(null);

  const [attestElapsed, setAttestElapsed] = useState(0);
  const [history, setHistory]             = useState<BridgeHistoryEntry[]>(() => loadBridgeHistory());
  const [showHistory, setShowHistory]     = useState(false);

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

  // Load the smart account's own USDC wallet balance whenever gasless mode, source chain,
  // or connected wallet changes. walletAddress is included so the balance refreshes when
  // the user connects or switches accounts — the SimpleAccount address derives from the owner EOA.
  useEffect(() => {
    if (!useGasless || !isAASupported(fromChain.id) || !walletAddress) {
      setSaWalletBalance("—");
      setSaAddress(null);
      return;
    }
    let cancelled = false;
    getSmartAccountAddress(fromChain.id)
      .then(addr => {
        if (!cancelled) setSaAddress(addr);
        return getUsdcBalance(addr, fromChain);
      })
      .then(bal => { if (!cancelled) setSaWalletBalance(bal); })
      .catch(() => { if (!cancelled) { setSaWalletBalance("—"); setSaAddress(null); } });
    return () => { cancelled = true; };
  }, [useGasless, fromChain, walletAddress]);

  // Load any saved bridge session on mount
  useEffect(() => {
    const session = loadSession();
    if (session) {
      const from = getChainById(session.fromChainId);
      const to   = getChainById(session.toChainId);
      if (from && to) setResumeSession(session);
      else clearSession();
    }
  }, []);

  // Poll Band Protocol oracle price (Arc Testnet) every 30 seconds
  useEffect(() => {
    async function fetchOraclePrice() {
      try {
        const res = await fetch("/api/oracle/price");
        if (!res.ok) return;
        const data = await res.json() as { rateFormatted: string };
        if (data.rateFormatted) setOraclePrice(`$${data.rateFormatted}`);
      } catch { /* non-fatal */ }
    }
    void fetchOraclePrice();
    const interval = setInterval(fetchOraclePrice, 30_000);
    return () => clearInterval(interval);
  }, []);

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

  // Disable gasless mode automatically when switching to a chain that doesn't support AA
  useEffect(() => {
    if (!isAASupported(fromChain.id)) setUseGasless(false);
  }, [fromChain.id]);

  // Attestation elapsed timer — counts up every second while waiting for Circle Iris
  useEffect(() => {
    if (bridgeStatus.step === "attesting") {
      if (!attestingStartRef.current) attestingStartRef.current = Date.now();
      const id = setInterval(() => {
        setAttestElapsed(Math.floor((Date.now() - (attestingStartRef.current ?? Date.now())) / 1000));
      }, 1000);
      return () => clearInterval(id);
    }
    attestingStartRef.current = null;
    setAttestElapsed(0);
    return undefined;
  }, [bridgeStatus.step]);

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

    const trackStatus = (status: BridgeStatus) => {
      setBridgeStatus(status);
      if (status.burnTxHash) lastBurnTxRef.current  = status.burnTxHash;
      if (status.feeTxHash)  lastFeeTxRef.current   = status.feeTxHash;
      if (status.mintTxHash) lastMintTxRef.current  = status.mintTxHash;
      if (
        status.step === "approving"  ||
        status.step === "collecting" ||
        status.step === "burning"    ||
        status.step === "attesting"  ||
        status.step === "minting"
      ) {
        currentStepRef.current = status.step;
      }
      if (status.step === "attesting" && status.burnTxHash) {
        saveSession({
          burnTxHash:   status.burnTxHash,
          feeTxHash:    status.feeTxHash,
          messageBytes: status.messageBytes,
          fromChainId:  fromChain.id,
          toChainId:    toChain.id,
          amount,
          recipient:    effectiveRecipient,
          savedAt:      Date.now(),
          useGasRelay:  useGasRelay && !!toChain.gasRelayerAddress,
        });
      }
    };

    try {
      if (useGasless && isAASupported(fromChain.id)) {
        await executeBridgeGasless(fromChain, toChain, amount, effectiveRecipient, trackStatus);
      } else {
        await executeBridge(fromChain, toChain, amount, effectiveRecipient, trackStatus,
          { useGasRelay: useGasRelay && !!toChain.gasRelayerAddress });
      }
      clearSession();
      if (lastBurnTxRef.current) {
        saveBridgeHistory({
          fromChainId: fromChain.id,
          toChainId:   toChain.id,
          amount,
          burnTxHash:  lastBurnTxRef.current,
          mintTxHash:  lastMintTxRef.current,
          completedAt: Date.now(),
        });
        setHistory(loadBridgeHistory());
      }
      await refreshBalances();
    } catch (err: unknown) {
      console.error("[bridge error]", err);
      setBridgeStatus({
        step: "error",
        message: "Bridge failed",
        error: friendlyError(err),
        failedAtStep: currentStepRef.current ?? undefined,
        feeTxHash:    lastFeeTxRef.current,
        burnTxHash:   lastBurnTxRef.current,
        mintTxHash:   lastMintTxRef.current,
      });
    }
  }

  async function handleResume() {
    if (!resumeSession || !walletAddress) return;
    const from = getChainById(resumeSession.fromChainId);
    const to   = getChainById(resumeSession.toChainId);
    if (!from || !to) { clearSession(); setResumeSession(null); return; }

    setFromChain(from);
    setToChain(to);
    setResumeSession(null);
    currentStepRef.current = null;
    lastBurnTxRef.current  = resumeSession.burnTxHash;
    lastFeeTxRef.current   = resumeSession.feeTxHash;
    lastMintTxRef.current  = undefined;

    const trackResumeStatus = (status: BridgeStatus) => {
      setBridgeStatus(status);
      if (status.burnTxHash) lastBurnTxRef.current  = status.burnTxHash;
      if (status.mintTxHash) lastMintTxRef.current  = status.mintTxHash;
      if (status.step === "attesting" || status.step === "minting") currentStepRef.current = status.step;
    };

    try {
      if (resumeSession.useGasRelay && to.gasRelayerAddress) {
        // Gas relay path: burn's mintRecipient was the GasRelayer contract.
        // Must call the relay API — receiveMessage would mint to GasRelayer, not the user.
        await resumeBridgeGasRelay(
          from, to,
          resumeSession.burnTxHash,
          resumeSession.messageBytes,
          resumeSession.feeTxHash,
          resumeSession.recipient,
          trackResumeStatus,
        );
      } else {
        await resumeBridge(
          from, to,
          resumeSession.burnTxHash,
          resumeSession.messageBytes,
          resumeSession.feeTxHash,
          trackResumeStatus,
        );
      }
      clearSession();
      if (lastBurnTxRef.current) {
        saveBridgeHistory({
          fromChainId: from.id,
          toChainId:   to.id,
          amount:      resumeSession?.amount ?? "",
          burnTxHash:  lastBurnTxRef.current,
          mintTxHash:  lastMintTxRef.current,
          completedAt: Date.now(),
        });
        setHistory(loadBridgeHistory());
      }
      await refreshBalances();
    } catch (err: unknown) {
      setBridgeStatus({
        step: "error",
        message: "Resume failed",
        error: friendlyError(err),
        failedAtStep: currentStepRef.current ?? undefined,
        feeTxHash:    lastFeeTxRef.current,
        burnTxHash:   lastBurnTxRef.current,
        mintTxHash:   lastMintTxRef.current,
      });
    }
  }

  function handleReset() {
    setBridgeStatus({ step: "idle", message: "" });
    setAmount("");
    currentStepRef.current = null;
    lastBurnTxRef.current  = undefined;
    lastFeeTxRef.current   = undefined;
    lastMintTxRef.current  = undefined;
    clearSession();
  }

  function handleDismissResume() {
    clearSession();
    setResumeSession(null);
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

  const walletChain    = walletChainId ? getChainById(walletChainId) : null;

  // In gasless mode the USDC comes from the smart account's own wallet, not the EOA.
  const gaslessActive    = useGasless && isAASupported(fromChain.id);
  const effectiveBalance = gaslessActive ? saWalletBalance : fromBalance;
  const fromBalanceNum   = safeParseBalance(effectiveBalance);

  // Insufficient balance — only flag when balance is known (not still loading)
  const insufficientBalance =
    fromBalanceNum !== null &&
    amountIsValid &&
    parsedAmount > fromBalanceNum;

  // Relay-fee minimum guard — net received must be > 0 after all fees deducted
  const relayFeeUnits = useGasRelay && toChain.gasRelayerAddress ? GAS_RELAY_FEE_UNITS : 0n;
  const netReceived   = feeBreakdown ? feeBreakdown.bridgeAmount - relayFeeUnits : null;
  const belowRelayMin = netReceived !== null && netReceived <= 0n && relayFeeUnits > 0n;

  // Estimated bridge time — Arc source needs finalized attestation (~3–5 min), others ~1–3 min
  const estimatedTime = fromChain.isArc ? "~3–5 min" : "~1–3 min";

  // Custom recipient validity — only flagged when the custom address field is active and non-empty
  const customRecipientInvalid =
    useCustomRecipient && recipient.trim() !== "" && !ethers.isAddress(recipient.trim());
  const customRecipientMissing =
    useCustomRecipient && recipient.trim() === "";

  const canBridge =
    !!walletAddress &&
    amountIsValid &&
    !isProcessing &&
    !wrongNetwork &&
    !sameChain &&
    !insufficientBalance &&
    !belowRelayMin &&
    !customRecipientInvalid &&
    !customRecipientMissing;

  function applyMaxBalance() {
    if (effectiveBalance !== "—" && effectiveBalance !== "0.000000") setAmount(effectiveBalance);
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
          <a href="/paymaster"
            className="flex items-center gap-1.5 text-xs text-violet-400 hover:text-violet-300 font-medium transition-colors">
            Paymaster ↗
          </a>
          <a href="/yield"
            className="flex items-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300 font-medium transition-colors">
            Yield ↗
          </a>
          <a href="https://faucet.circle.com" target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-[#4F9CF9] transition-colors">
            Faucet <ExternalLink className="w-3 h-3" />
          </a>
          {fromChain.explorerUrl ? (
            <a href={fromChain.explorerUrl} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-[#4F9CF9] transition-colors">
              Explorer <ExternalLink className="w-3 h-3" />
            </a>
          ) : null}
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
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    <p className="text-slate-400 text-xs">
                      Burn on source · Attest · Mint natively on destination
                    </p>
                    {oraclePrice && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-400/80 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
                        <span className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse" />
                        USDC {oraclePrice} · Band
                      </span>
                    )}
                  </div>
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

              {/* ── Resume interrupted session banner ── */}
              {resumeSession && bridgeStatus.step === "idle" && (() => {
                const from = getChainById(resumeSession.fromChainId);
                const to   = getChainById(resumeSession.toChainId);
                if (!from || !to) return null;
                const minsAgo = Math.round((Date.now() - resumeSession.savedAt) / 60000);
                return (
                  <div className="flex items-start justify-between gap-3 px-4 py-3 bg-[#4F9CF9]/10 border border-[#4F9CF9]/30 rounded-xl">
                    <div className="flex items-start gap-2 min-w-0">
                      <RotateCcw className="w-4 h-4 text-[#4F9CF9] mt-0.5 flex-shrink-0" />
                      <div className="min-w-0">
                        <p className="text-[#7BB8FB] text-xs font-semibold">Interrupted transfer found</p>
                        <p className="text-slate-400 text-[11px] mt-0.5 leading-relaxed">
                          {resumeSession.amount} USDC · {from.shortName} → {to.shortName}
                          {minsAgo > 0 ? ` · ${minsAgo}m ago` : ""}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-1.5 flex-shrink-0">
                      {walletAddress ? (
                        <button
                          onClick={handleResume}
                          className="text-xs font-semibold text-[#4F9CF9] border border-[#4F9CF9]/40 px-3 py-1.5 rounded-lg hover:bg-[#4F9CF9]/10 transition-all whitespace-nowrap"
                        >
                          Resume
                        </button>
                      ) : (
                        <span className="text-xs text-slate-500 py-1.5">Connect wallet to resume</span>
                      )}
                      <button
                        onClick={handleDismissResume}
                        className="text-xs text-slate-500 hover:text-slate-300 px-2 py-1.5 transition-colors"
                        title="Dismiss"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                );
              })()}

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
                    <span className="text-xs text-slate-500">
                      {gaslessActive ? "Smart account wallet" : "Balance"}
                    </span>
                    <button onClick={applyMaxBalance}
                      disabled={!fromBalanceNum || isProcessing}
                      className="text-xs text-[#4F9CF9] hover:text-[#7BB8FB] font-mono transition-colors disabled:text-slate-500 disabled:cursor-default">
                      {effectiveBalance} USDC
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
                    disabled={!fromBalanceNum || !walletAddress || isProcessing}
                    className="text-xs font-semibold text-[#4F9CF9] hover:text-[#7BB8FB] disabled:text-slate-600 disabled:cursor-not-allowed transition-colors">
                    MAX
                  </button>
                  <span className="text-slate-400 text-sm font-medium">USDC</span>
                </div>
              </div>

              {/* Insufficient balance warning */}
              {insufficientBalance && (
                <p className="text-xs text-red-400 px-1">
                  {gaslessActive
                    ? `Insufficient USDC in your smart account — it holds ${effectiveBalance} USDC on ${fromChain.shortName}. Send USDC to the smart account address first.`
                    : `Insufficient balance — you have ${effectiveBalance} USDC on ${fromChain.shortName}.`}
                </p>
              )}

              {/* Relay fee minimum warning */}
              {belowRelayMin && !insufficientBalance && (
                <p className="text-xs text-amber-400 px-1">
                  Amount too low — the 1 USDC relay fee would consume the entire transfer.
                </p>
              )}

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
                  <>
                    <input type="text" value={recipient}
                      onChange={(e) => setRecipient(e.target.value)}
                      placeholder="0x… recipient address on destination chain"
                      disabled={isProcessing}
                      className={cn(
                        "mt-2 w-full px-3 py-2.5 rounded-xl text-sm font-mono text-white",
                        "bg-slate-800/80 border focus:outline-none transition-colors disabled:opacity-50",
                        customRecipientInvalid
                          ? "border-red-500/60 focus:border-red-500"
                          : "border-slate-700/60 focus:border-[#4F9CF9]/60",
                        "placeholder:text-slate-600"
                      )}
                    />
                    {customRecipientInvalid && (
                      <p className="text-xs text-red-400 px-1 mt-1">
                        Invalid Ethereum address.
                      </p>
                    )}
                  </>
                )}
              </div>

              {/* ── Gas Relay toggle ── */}
              {toChain.gasRelayerAddress && (
                <div className="flex items-center justify-between px-4 py-3 bg-slate-800/30 rounded-xl border border-slate-700/40">
                  <div className="flex items-start gap-2">
                    <Zap className="w-3.5 h-3.5 text-[#4F9CF9] mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-xs text-slate-300 font-medium">Gasless relay</p>
                      <p className="text-[10px] text-slate-500 mt-0.5">
                        Skip wallet switch — 1 USDC relay fee
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => setUseGasRelay(!useGasRelay)}
                    disabled={isProcessing}
                    className={cn(
                      "relative w-9 h-5 rounded-full transition-colors duration-200 flex-shrink-0",
                      useGasRelay ? "bg-[#4F9CF9]" : "bg-slate-700",
                      isProcessing && "opacity-50 cursor-not-allowed"
                    )}
                    aria-checked={useGasRelay}
                    role="switch"
                    aria-label="Enable gasless relay"
                  >
                    <span className={cn(
                      "absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200",
                      useGasRelay && "translate-x-4"
                    )} />
                  </button>
                </div>
              )}

              {/* ── ERC-4337 Gasless Bridge toggle ── */}
              {isAASupported(fromChain.id) && (
                <div className={cn(
                  "flex items-center justify-between px-4 py-3 rounded-xl border transition-all",
                  useGasless
                    ? "bg-violet-950/30 border-violet-500/40"
                    : "bg-slate-800/30 border-slate-700/40"
                )}>
                  <div className="flex items-start gap-2">
                    <Zap className={cn("w-3.5 h-3.5 mt-0.5 flex-shrink-0", useGasless ? "text-violet-400" : "text-violet-400/60")} />
                    <div>
                      <p className="text-xs text-slate-300 font-medium">
                        ERC-4337 gasless burn
                        <span className="ml-1.5 inline-flex items-center text-[9px] font-bold bg-violet-500/20 text-violet-300 border border-violet-500/30 px-1.5 py-0.5 rounded-full">
                          BETA
                        </span>
                      </p>
                      <p className="text-[10px] text-slate-500 mt-0.5">
                        No ETH needed on source — gas paid in USDC via Paymaster
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => setUseGasless(!useGasless)}
                    disabled={isProcessing}
                    className={cn(
                      "relative w-9 h-5 rounded-full transition-colors duration-200 flex-shrink-0",
                      useGasless ? "bg-violet-500" : "bg-slate-700",
                      isProcessing && "opacity-50 cursor-not-allowed"
                    )}
                    aria-checked={useGasless}
                    role="switch"
                    aria-label="Enable ERC-4337 gasless bridging"
                  >
                    <span className={cn(
                      "absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200",
                      useGasless && "translate-x-4"
                    )} />
                  </button>
                </div>
              )}

              {/* ── Gasless mode info banner ── */}
              {useGasless && isAASupported(fromChain.id) && (
                <div className="flex items-start gap-2 px-4 py-3 bg-violet-950/20 border border-violet-500/20 rounded-xl">
                  <Info className="w-3.5 h-3.5 text-violet-400 mt-0.5 flex-shrink-0" />
                  <div className="text-[11px] text-violet-300/80 leading-relaxed space-y-1.5">
                    <p>
                      USDC is burned from your{" "}
                      <span className="font-semibold text-violet-300">smart account wallet</span>{" "}
                      ({saWalletBalance === "—" ? "loading…" : `${saWalletBalance} USDC available`}).
                      Gas is paid from the Paymaster gas vault — no ETH or AVAX needed.
                    </p>
                    {/* Smart account address — send USDC here to fund the burn */}
                    <div className="rounded-lg bg-violet-950/40 border border-violet-500/20 px-2.5 py-2">
                      <p className="text-[10px] text-violet-400/70 mb-1 uppercase tracking-wide">Your smart account address</p>
                      {saAddress ? (
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[10px] text-violet-200 break-all flex-1 select-all">{saAddress}</span>
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard.writeText(saAddress).then(() => {
                                setSaAddressCopied(true);
                                setTimeout(() => setSaAddressCopied(false), 2000);
                              }).catch(() => {});
                            }}
                            className="flex-shrink-0 text-[10px] px-2 py-0.5 rounded bg-violet-700/40 hover:bg-violet-600/50 text-violet-300 transition-colors"
                          >
                            {saAddressCopied ? "Copied!" : "Copy"}
                          </button>
                        </div>
                      ) : (
                        <span className="text-violet-400/50 text-[10px]">Connect wallet to see address</span>
                      )}
                      <p className="text-[10px] text-violet-400/60 mt-1.5">
                        Send USDC here from MetaMask before bridging.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* ── Fee & Bridge Summary ── */}
              {amountIsValid && !sameChain && feeBreakdown && (
                <div className="px-4 py-3 bg-slate-800/40 rounded-xl border border-slate-700/40 space-y-2">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-500">You send</span>
                    <span className="text-white font-medium">{amount} USDC</span>
                  </div>

                  {feeBreakdown.active && (
                    <div className="flex justify-between text-xs">
                      <span className="flex items-center gap-1 text-slate-500">
                        <Zap className="w-3 h-3 text-[#4F9CF9]" />
                        Protocol fee ({FEE_BPS / 100}%)
                      </span>
                      <span className="text-slate-300 font-mono">
                        −{formatUsdc(feeBreakdown.feeAmount)} USDC
                      </span>
                    </div>
                  )}

                  {useGasRelay && toChain.gasRelayerAddress && (
                    <div className="flex justify-between text-xs">
                      <span className="flex items-center gap-1 text-slate-500">
                        <Zap className="w-3 h-3 text-purple-400" />
                        Relay fee (gasless)
                      </span>
                      <span className="text-slate-300 font-mono">
                        −{formatUsdc(GAS_RELAY_FEE_UNITS)} USDC
                      </span>
                    </div>
                  )}

                  <div className="border-t border-slate-700/60 pt-2 flex justify-between text-xs">
                    <span className="text-slate-500">You receive</span>
                    <span className="text-emerald-400 font-semibold">
                      {formatUsdc(
                        feeBreakdown.bridgeAmount -
                          (useGasRelay && toChain.gasRelayerAddress ? GAS_RELAY_FEE_UNITS : 0n)
                      )} USDC
                    </span>
                  </div>

                  <div className="flex justify-between text-xs">
                    <span className="text-slate-500">Protocol</span>
                    <span className="text-slate-300">Circle CCTP V2</span>
                  </div>

                  <div className="flex justify-between text-xs">
                    <span className="flex items-center gap-1 text-slate-500">
                      <Clock className="w-3 h-3" />
                      Est. time
                    </span>
                    <span className="text-slate-400">{estimatedTime}</span>
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
                    stepLabels={useGasRelay && toChain.gasRelayerAddress ? { minting: "Relay" } : undefined}
                  />

                  {/* Attestation elapsed timer */}
                  {bridgeStatus.step === "attesting" && attestElapsed > 0 && (
                    <div className="flex items-center justify-center gap-1.5 text-xs text-slate-500">
                      <Clock className="w-3 h-3 animate-pulse" />
                      <span>
                        Waiting for attestation —{" "}
                        {attestElapsed >= 60
                          ? `${Math.floor(attestElapsed / 60)}m ${attestElapsed % 60}s`
                          : `${attestElapsed}s`}
                      </span>
                    </div>
                  )}

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

                  {bridgeStatus.step === "done" && (
                    <button
                      onClick={() => addUsdcToWallet(toChain).catch(() => {})}
                      className="w-full py-2 text-xs font-semibold text-[#4F9CF9] hover:text-[#7BB8FB] border border-[#4F9CF9]/30 hover:border-[#4F9CF9]/60 rounded-xl transition-all"
                    >
                      Add USDC to wallet on {toChain.shortName}
                    </button>
                  )}

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
                Arc Testnet CCTP Domain: <span className="text-slate-400 font-mono">26</span>.
                Get testnet USDC from the{" "}
                <a href="https://faucet.circle.com" target="_blank" rel="noopener noreferrer"
                  className="text-[#4F9CF9] hover:underline">Circle Faucet</a>.
              </p>
            </div>
          </div>

          {/* ── Chain pills ── */}
          <div className="grid grid-cols-2 gap-2">
            <a href="https://docs.arc.io" target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-2 px-3 py-2 bg-[#111827]/60 border border-white/[0.05] rounded-xl hover:border-[#4F9CF9]/30 transition-all group">
              <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0"
                style={{ background: CHAINS.ARC_TESTNET.logoColor }}>⬡</span>
              <div className="min-w-0">
                <div className="text-xs text-white font-medium truncate">Arc Docs</div>
                <div className="text-[10px] text-slate-500">docs.arc.io</div>
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
            <a href="https://github.com/circlefin/arc-node" target="_blank" rel="noopener noreferrer"
              className="col-span-2 flex items-center gap-2 px-3 py-2 bg-[#111827]/60 border border-white/[0.05] rounded-xl hover:border-[#4F9CF9]/30 transition-all group">
              <span className="w-5 h-5 rounded-full bg-[#24292e] border border-white/10 flex items-center justify-center flex-shrink-0">
                <svg viewBox="0 0 16 16" className="w-3 h-3 fill-white"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
              </span>
              <div className="min-w-0">
                <div className="text-xs text-white font-medium truncate">Arc Network — GitHub</div>
                <div className="text-[10px] text-slate-500">circlefin/arc-node</div>
              </div>
              <ExternalLink className="w-3 h-3 text-slate-600 group-hover:text-[#4F9CF9] ml-auto transition-colors" />
            </a>
          </div>
          {/* ── Bridge History ── */}
          {history.length > 0 && (
            <div className="bg-[#111827]/80 border border-white/[0.06] rounded-2xl overflow-hidden">
              <button
                onClick={() => setShowHistory(!showHistory)}
                className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-white/[0.02] transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Clock className="w-3.5 h-3.5 text-slate-500" />
                  <span className="text-xs font-medium text-slate-400">
                    Recent bridges ({history.length})
                  </span>
                </div>
                {showHistory
                  ? <ChevronUp className="w-3.5 h-3.5 text-slate-500" />
                  : <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
                }
              </button>

              {showHistory && (
                <div className="border-t border-white/[0.05] divide-y divide-white/[0.04]">
                  {history.map((entry) => {
                    const from = getChainById(entry.fromChainId);
                    const to   = getChainById(entry.toChainId);
                    const minsAgo = Math.round((Date.now() - entry.completedAt) / 60000);
                    const timeLabel =
                      minsAgo < 1   ? "just now" :
                      minsAgo < 60  ? `${minsAgo}m ago` :
                      minsAgo < 1440 ? `${Math.floor(minsAgo / 60)}h ago` :
                      `${Math.floor(minsAgo / 1440)}d ago`;
                    return (
                      <div key={entry.id} className="px-5 py-3 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 text-xs text-white">
                            <span className="font-mono font-semibold">{entry.amount} USDC</span>
                            <span className="text-slate-600">·</span>
                            <span className="text-slate-400">
                              {from?.shortName ?? entry.fromChainId} → {to?.shortName ?? entry.toChainId}
                            </span>
                          </div>
                          <p className="text-[10px] text-slate-600 mt-0.5">{timeLabel}</p>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {entry.mintTxHash && to && (
                            <a
                              href={`${to.explorerUrl}/tx/${entry.mintTxHash}`}
                              target="_blank" rel="noopener noreferrer"
                              className="text-[10px] text-emerald-500 hover:text-emerald-400 flex items-center gap-1 transition-colors"
                            >
                              Mint <ExternalLink className="w-2.5 h-2.5" />
                            </a>
                          )}
                          {from && (
                            <a
                              href={`${from.explorerUrl}/tx/${entry.burnTxHash}`}
                              target="_blank" rel="noopener noreferrer"
                              className="text-[10px] text-slate-500 hover:text-slate-300 flex items-center gap-1 transition-colors"
                            >
                              Burn <ExternalLink className="w-2.5 h-2.5" />
                            </a>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

        </div>
      </main>
    </div>
  );
}
