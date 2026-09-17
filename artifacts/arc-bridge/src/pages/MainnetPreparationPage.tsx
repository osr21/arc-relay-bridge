import { useEffect, useState } from "react";
import { ArrowRight, CircleAlert, Clock3, ShieldCheck } from "lucide-react";
import { MAINNET_CHAINS, MAINNET_RELEASE } from "@workspace/arc-relay-sdk/mainnet";
import { assertBackendEnvironment } from "@/lib/network";

type Area = "bridge" | "yield" | "paymaster" | "refuel" | "portfolio" | "ecosystem" | "developers";

const PAGE_COPY: Record<Area, { title: string; detail: string }> = {
  bridge: {
    title: "Arc ↔ Base bridge preparation",
    detail: "Mainnet routing is configured for review, but transfers are not live.",
  },
  yield: {
    title: "Yield is disabled",
    detail: "No yield strategy has been selected. This route does not offer deposits, withdrawals, quotes, or APY.",
  },
  paymaster: {
    title: "Account abstraction preparation",
    detail: "Bundler, paymaster, and sponsorship support are not live on mainnet.",
  },
  refuel: {
    title: "Gas refuel preparation",
    detail: "Payout verification, payment processing, and liquidity are not live on mainnet.",
  },
  portfolio: {
    title: "Portfolio preparation",
    detail: "Portfolio actions remain inactive until mainnet launch configuration is complete.",
  },
  ecosystem: {
    title: "Ecosystem preparation",
    detail: "Mainnet product routes are visible for preparation only.",
  },
  developers: {
    title: "Developer preparation",
    detail: "Integration routes remain inactive until reviewed mainnet configuration is available.",
  },
};

export default function MainnetPreparationPage({ area }: { area: Area }) {
  const [networkError, setNetworkError] = useState<string | null>(null);

  useEffect(() => {
    void assertBackendEnvironment().catch((error: unknown) => {
      setNetworkError(error instanceof Error ? error.message : "Unable to verify API network status.");
    });
  }, []);

  const copy = PAGE_COPY[area];
  const features = Object.entries(MAINNET_RELEASE.features) as Array<
    [string, { enabled: boolean; reason: string }]
  >;

  return (
    <div className="min-h-screen bg-[#0C1220] text-white flex flex-col">
      <header className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06]">
        <a href="/" className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#354457] to-[#4F9CF9] flex items-center justify-center">
            <span className="text-white text-sm font-bold">⬡</span>
          </div>
          <div>
            <h1 className="font-bold text-base leading-none">Arc Relay Bridge</h1>
            <p className="text-slate-500 text-[11px] mt-0.5">Mainnet preparation · Arc + Base</p>
          </div>
        </a>
        <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1.5 text-xs font-semibold text-amber-300">
          Launch pending
        </span>
      </header>

      <main className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-xl space-y-3">
          <section className="bg-[#111827] border border-white/[0.07] rounded-2xl shadow-2xl p-6">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 rounded-lg bg-amber-400/10 p-2">
                <Clock3 className="w-4 h-4 text-amber-300" />
              </div>
              <div>
                <h2 className="text-white font-bold text-lg">{copy.title}</h2>
                <p className="text-slate-400 text-sm mt-1">{copy.detail}</p>
              </div>
            </div>

            <div className="mt-5 grid grid-cols-[1fr_auto_1fr] items-center gap-3 rounded-xl border border-slate-700/60 bg-slate-800/40 p-4">
              <ChainLabel chain={MAINNET_CHAINS.ARC_MAINNET} />
              <ArrowRight className="w-4 h-4 text-slate-500" />
              <ChainLabel chain={MAINNET_CHAINS.BASE_MAINNET} />
            </div>
            <p className="mt-2 text-[11px] text-slate-500">
              Mainnet selector scope: Arc (5042) and Base (8453) only. USDC uses 6-decimal CCTP amounts; native currencies use 18 decimals.
            </p>

            {networkError && (
              <div className="mt-4 flex gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
                <CircleAlert className="w-4 h-4 shrink-0" />
                <span>{networkError}</span>
              </div>
            )}

            <button
              disabled
              className="mt-5 w-full rounded-xl bg-slate-700 py-3.5 text-sm font-semibold text-slate-400 cursor-not-allowed"
            >
              Mainnet launch pending — actions unavailable
            </button>
            <p className="mt-2 text-center text-[11px] text-slate-500">
              No wallet connection, approval, burn, relay, account-abstraction action, or payout is requested.
            </p>
          </section>

          <section className="rounded-2xl border border-white/[0.06] bg-[#111827]/70 px-5 py-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-200">
              <ShieldCheck className="w-4 h-4 text-[#4F9CF9]" />
              Launch status
            </div>
            <div className="mt-3 space-y-2">
              {features.map(([feature, capability]) => (
                <div key={feature} className="flex items-start justify-between gap-3 text-xs">
                  <span className="capitalize text-slate-300">{feature}</span>
                  <span className="max-w-sm text-right text-slate-500">{capability.reason}</span>
                </div>
              ))}
            </div>
            <p className="mt-4 border-t border-white/[0.06] pt-3 text-[11px] text-slate-500">
              No launch, audit, performance, or yield claim is made on this page.
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}

function ChainLabel({ chain }: { chain: (typeof MAINNET_CHAINS)[keyof typeof MAINNET_CHAINS] }) {
  return (
    <div>
      <div className="text-sm font-semibold text-white">{chain.name}</div>
      <div className="mt-0.5 text-[11px] text-slate-500">
        {chain.nativeCurrency.symbol} · chain {chain.id}
      </div>
    </div>
  );
}