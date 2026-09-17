import { ExternalLink, Zap, TrendingUp, Fuel, RefreshCw, Shield, Code2, ArrowRight, Globe } from "lucide-react";
import { CHAINS } from "@/lib/chains";

const FEATURES = [
  {
    icon: <ArrowRight className="w-4 h-4" />,
    color: "#4F9CF9",
    title: "Cross-Chain Bridge",
    description:
      "Burn USDC on any supported chain and natively mint it on the destination — no wrapped tokens, no liquidity pools. Built on Circle CCTP V2.",
    route: "/",
    label: "Open Bridge",
  },
  {
    icon: <TrendingUp className="w-4 h-4" />,
    color: "#10b981",
    title: "Yield Vaults",
    description:
      "Deposit USDC into on-chain vaults across all four chains. Arc Testnet yields 18.5% APY. Compare rates and rebalance in one click.",
    route: "/yield",
    label: "View Yield",
  },
  {
    icon: <Zap className="w-4 h-4" />,
    color: "#a78bfa",
    title: "ERC-4337 Paymaster",
    description:
      "The only deployed USDC-denominated paymaster on Arc Testnet. Funds gas for smart-account UserOps so users never touch native tokens.",
    route: "/paymaster",
    label: "Manage Paymaster",
  },
  {
    icon: <Fuel className="w-4 h-4" />,
    color: "#f97316",
    title: "Gas Refuel",
    description:
      "Spend Arc USDC to receive native ETH or AVAX on Sepolia, Base, or Fuji. Solves the gas-bootstrapping problem for new cross-chain users.",
    route: "/refuel",
    label: "Refuel Gas",
  },
  {
    icon: <RefreshCw className="w-4 h-4" />,
    color: "#06b6d4",
    title: "Gas Relay",
    description:
      "Enable Gas Relay mode on any bridge transfer. The GasRelayer contract covers destination-chain gas, charged from the USDC transfer amount.",
    route: "/",
    label: "Try Bridge",
  },
  {
    icon: <Shield className="w-4 h-4" />,
    color: "#f59e0b",
    title: "Audited Contracts",
    description:
      "All 16 contracts (4 types × 4 chains) are hardened to v6. Key fixes: ERC-7562 storage constraint, two-step ownership, reentrancy guards.",
    route: null,
    label: null,
  },
];

const CONTRACTS = [
  {
    name: "USDC Paymaster",
    description: "ERC-4337 v0.7 USDC paymaster for gasless smart-account ops",
    addresses: {
      "Arc Testnet":       "0xEE39e1690F1bE07e8a68813f57cE3142197CECf6",
      "Ethereum Sepolia":  "0xe7ED22eF9Af9CAd98B048979dbd726e89dd0D417",
      "Base Sepolia":      "0x5f309aE9A9A364Ae18af77b7733bB9C43A032A4A",
      "Avalanche Fuji":    "0x0D3B7bd972F4Cc3CDAB62E1cFafcA79F8d7167f5",
    },
  },
  {
    name: "GasRelayer",
    description: "Relays CCTP mint on behalf of users — no destination gas needed",
    addresses: {
      "Arc Testnet":       "0xf89773D7d9C43c01203793bf991e2550975a0C49",
      "Ethereum Sepolia":  "0x5eA2A91629245074D01EFf64fc223233c2a805E6",
      "Base Sepolia":      "0x5bE70628f49aFb90D81d169bff1533F437B967BB",
      "Avalanche Fuji":    "0x53183000a7Ae24AE9F1126271a66Eff1161a58Ec",
    },
  },
  {
    name: "FeeRouter",
    description: "Routes protocol fees with two-step ownership and reentrancy protection",
    addresses: {
      "Arc Testnet":       "0x0812a44BDB8975d1Fa1DA93726385Bc4dDC31C6A",
      "Ethereum Sepolia":  "0x9d54E104680D2C80FE117e1A66862f619F0a4cBa",
      "Base Sepolia":      "0x245aB059961D5D4A29D2fDf6AefA75b029Ed445d",
      "Avalanche Fuji":    "0xce4794207CFCCDC06B283b6942f5BB44a32F5398",
    },
  },
  {
    name: "YieldVault",
    description: "Permissionless USDC yield vault with reentrancy guard and rescue-token protection",
    addresses: {
      "Arc Testnet":       "0xFf8f0Fc1Cca51ddE49ee1E7083D36CC99Af01665",
      "Ethereum Sepolia":  "0xd4a11E7C3512A5c9C09E0296bB06490244476673",
      "Base Sepolia":      "0x0D3B7bd972F4Cc3CDAB62E1cFafcA79F8d7167f5",
      "Avalanche Fuji":    "0xEE39e1690F1bE07e8a68813f57cE3142197CECf6",
    },
  },
];

const CHAIN_EXPLORERS: Record<string, string> = {
  "Arc Testnet":      CHAINS.ARC_TESTNET.explorerUrl,
  "Ethereum Sepolia": CHAINS.ETH_SEPOLIA.explorerUrl,
  "Base Sepolia":     CHAINS.BASE_SEPOLIA.explorerUrl,
  "Avalanche Fuji":   CHAINS.AVAX_FUJI.explorerUrl,
};

const CHAIN_COLORS: Record<string, string> = {
  "Arc Testnet":      "#354457",
  "Ethereum Sepolia": "#627EEA",
  "Base Sepolia":     "#0052FF",
  "Avalanche Fuji":   "#E84142",
};

const STACK = [
  { label: "Circle CCTP V2", href: "https://developers.circle.com/stablecoins/cctp-getting-started" },
  { label: "Circle Iris API", href: "https://developers.circle.com/stablecoins/cctp-apis-and-sdks" },
  { label: "ERC-4337 v0.7",  href: "https://eips.ethereum.org/EIPS/eip-4337" },
  { label: "Arc Testnet",    href: "https://docs.arc.io" },
  { label: "ethers.js v6",   href: "https://docs.ethers.org/v6/" },
  { label: "React 19",       href: "https://react.dev" },
];

export default function EcosystemPage() {
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
            <p className="text-slate-500 text-[11px] mt-0.5">Arc Ecosystem · Sample App</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <a href="/"           className="text-xs text-[#4F9CF9]  hover:text-blue-300   font-medium transition-colors">Bridge ↗</a>
          <a href="/portfolio"  className="text-xs text-cyan-400   hover:text-cyan-300   font-medium transition-colors">Portfolio ↗</a>
          <a href="/yield"      className="text-xs text-emerald-400 hover:text-emerald-300 font-medium transition-colors">Yield ↗</a>
          <a href="/paymaster"  className="text-xs text-violet-400 hover:text-violet-300  font-medium transition-colors">Paymaster ↗</a>
          <a href="/refuel"     className="text-xs text-orange-400 hover:text-orange-300  font-medium transition-colors">Refuel ↗</a>
          <a href="/developers" className="text-xs text-indigo-400 hover:text-indigo-300  font-medium transition-colors">Developers ↗</a>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-12 space-y-16">

        {/* ── Hero ── */}
        <section className="space-y-6">
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-full bg-[#4F9CF9]/10 border border-[#4F9CF9]/20 text-[#4F9CF9] text-[11px] font-medium">
              Arc Ecosystem · Sample App
            </span>
            <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[11px] font-medium">
              Testnet · Live
            </span>
          </div>

          <div>
            <h2 className="text-4xl font-bold text-white leading-tight">
              Arc Relay Bridge
            </h2>
            <p className="text-slate-400 text-lg mt-3 leading-relaxed max-w-2xl">
              A production-grade cross-chain USDC bridge built on Circle's CCTP V2. Move native USDC between Arc,
              Ethereum, Base, and Avalanche — no wrapped tokens, no liquidity pools, no ETH needed for gas.
            </p>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <a href="/"
              className="inline-flex items-center gap-2 px-4 py-2 bg-[#4F9CF9] hover:bg-[#4F9CF9]/80 text-white font-medium text-sm rounded-xl transition-colors">
              Open the Bridge <ArrowRight className="w-3.5 h-3.5" />
            </a>
            <a href="https://discord.com/invite/buildonarc" target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 bg-white/[0.05] hover:bg-white/[0.08] border border-white/[0.08] text-slate-300 font-medium text-sm rounded-xl transition-colors">
              Arc Developer Discord <ExternalLink className="w-3.5 h-3.5" />
            </a>
            <a href="https://docs.arc.io/arc/references/sample-applications" target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 bg-white/[0.05] hover:bg-white/[0.08] border border-white/[0.08] text-slate-300 font-medium text-sm rounded-xl transition-colors">
              Sample App Gallery <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        </section>

        {/* ── Feature Grid ── */}
        <section className="space-y-4">
          <h3 className="text-lg font-semibold text-white">What it includes</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {FEATURES.map((f) => (
              <div key={f.title}
                className="bg-[#111827]/80 border border-white/[0.06] rounded-2xl p-5 flex flex-col gap-3">
                <div className="w-8 h-8 rounded-xl flex items-center justify-center"
                  style={{ background: `${f.color}18`, color: f.color }}>
                  {f.icon}
                </div>
                <div>
                  <h4 className="text-white text-sm font-semibold">{f.title}</h4>
                  <p className="text-slate-500 text-xs mt-1 leading-relaxed">{f.description}</p>
                </div>
                {f.route && f.label && (
                  <a href={f.route}
                    className="mt-auto text-xs font-medium transition-colors flex items-center gap-1"
                    style={{ color: f.color }}>
                    {f.label} <ArrowRight className="w-3 h-3" />
                  </a>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* ── Ecosystem Positioning ── */}
        <section className="space-y-4">
          <h3 className="text-lg font-semibold text-white">Why it matters for Arc</h3>
          <div className="bg-[#111827]/80 border border-white/[0.06] rounded-2xl p-6 space-y-4">
            {[
              {
                title: "Liquidity on-ramp",
                color: "#4F9CF9",
                body: "Arc is a new L1 with no native liquidity yet. Every user and developer who wants to build or transact on Arc needs to move USDC from Ethereum, Base, or Avalanche. This bridge is the standalone entry point — no SDK integration required.",
              },
              {
                title: "Gas bootstrapping",
                color: "#10b981",
                body: "Arc uses USDC as gas. New users who want to bridge in face a chicken-and-egg problem: they need Arc USDC to pay for the mint, but can't get it without first bridging. The GasRelayer contract solves this by covering destination gas from the bridged amount.",
              },
              {
                title: "ERC-4337 reference implementation",
                color: "#a78bfa",
                body: "Arc's account abstraction docs list providers but include no reference USDC paymaster. This dApp's Paymaster contract is the first deployed USDC-denominated ERC-4337 v0.7 paymaster on Arc Testnet — a direct contribution to the AA ecosystem.",
              },
              {
                title: "CCTP V2 reference code",
                color: "#f97316",
                body: "The full CCTP V2 integration in bridge.ts — 7-param depositForBurn, per-chain minFinalityThreshold, Iris attestation polling — is the most complete open-source CCTP V2 implementation targeting Arc. Developers can use it directly as a reference.",
              },
              {
                title: "Circle App Kit complement",
                color: "#06b6d4",
                body: "Circle's Bridge Kit SDK lets developers embed bridging into their own apps. This bridge is the standalone counterpart for users who arrive directly — covering the last mile that the SDK doesn't address.",
              },
            ].map((point) => (
              <div key={point.title} className="flex gap-4">
                <div className="w-1 rounded-full flex-shrink-0 mt-1"
                  style={{ background: point.color, minHeight: "1.5rem" }} />
                <div>
                  <p className="text-sm font-semibold text-white">{point.title}</p>
                  <p className="text-xs text-slate-400 mt-1 leading-relaxed">{point.body}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── Tech Stack ── */}
        <section className="space-y-4">
          <h3 className="text-lg font-semibold text-white">Built on Circle's stack</h3>
          <div className="flex flex-wrap gap-2">
            {STACK.map((s) => (
              <a key={s.label} href={s.href} target="_blank" rel="noopener noreferrer"
                className="px-3 py-1.5 bg-[#111827]/80 border border-white/[0.06] rounded-full text-xs text-slate-300 hover:text-[#4F9CF9] hover:border-[#4F9CF9]/30 transition-all flex items-center gap-1.5">
                {s.label} <ExternalLink className="w-2.5 h-2.5" />
              </a>
            ))}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-2">
            {[
              { label: "Chains",    value: "4" },
              { label: "Contracts", value: "16" },
              { label: "Protocol",  value: "CCTP V2" },
              { label: "AA",        value: "ERC-4337 v0.7" },
            ].map((stat) => (
              <div key={stat.label}
                className="bg-[#111827]/80 border border-white/[0.06] rounded-xl px-4 py-3 text-center">
                <p className="text-xl font-bold text-white">{stat.value}</p>
                <p className="text-xs text-slate-500 mt-0.5">{stat.label}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Deployed Contracts ── */}
        <section className="space-y-4">
          <h3 className="text-lg font-semibold text-white">Deployed contracts — all chains</h3>
          <div className="space-y-3">
            {CONTRACTS.map((contract) => (
              <div key={contract.name}
                className="bg-[#111827]/80 border border-white/[0.06] rounded-2xl overflow-hidden">
                <div className="px-5 py-3.5 border-b border-white/[0.04]">
                  <h4 className="text-sm font-semibold text-white">{contract.name}</h4>
                  <p className="text-xs text-slate-500 mt-0.5">{contract.description}</p>
                </div>
                <div className="divide-y divide-white/[0.04]">
                  {Object.entries(contract.addresses).map(([chain, addr]) => (
                    <div key={chain} className="px-5 py-2.5 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full flex-shrink-0"
                          style={{ background: CHAIN_COLORS[chain] }} />
                        <span className="text-xs text-slate-400">{chain}</span>
                      </div>
                      <a href={`${CHAIN_EXPLORERS[chain]}/address/${addr}`}
                        target="_blank" rel="noopener noreferrer"
                        className="text-[11px] font-mono text-slate-500 hover:text-[#4F9CF9] flex items-center gap-1 transition-colors">
                        {addr.slice(0, 6)}…{addr.slice(-4)}
                        <ExternalLink className="w-2.5 h-2.5" />
                      </a>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── Submit / Links ── */}
        <section className="space-y-4">
          <h3 className="text-lg font-semibold text-white">Submit this app to the Arc ecosystem</h3>
          <div className="bg-[#111827]/80 border border-white/[0.06] rounded-2xl p-6 space-y-4">
            <p className="text-sm text-slate-400 leading-relaxed">
              Arc lists community-built sample apps in the{" "}
              <a href="https://docs.arc.io/arc/references/sample-applications"
                target="_blank" rel="noopener noreferrer"
                className="text-[#4F9CF9] hover:underline">
                Sample Applications reference
              </a>
              . The process is to open a PR against the Arc docs repo or post in the{" "}
              <a href="https://discord.com/invite/buildonarc"
                target="_blank" rel="noopener noreferrer"
                className="text-[#4F9CF9] hover:underline">
                Arc developer Discord
              </a>{" "}
              with a short description, live demo link, and GitHub repo.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[
                {
                  icon: <Globe className="w-4 h-4" />,
                  label: "Arc Developer Discord",
                  sub: "discord.com/invite/buildonarc",
                  href: "https://discord.com/invite/buildonarc",
                  color: "#4F9CF9",
                },
                {
                  icon: <Code2 className="w-4 h-4" />,
                  label: "Arc Docs",
                  sub: "docs.arc.io",
                  href: "https://docs.arc.io",
                  color: "#10b981",
                },
                {
                  icon: <ExternalLink className="w-4 h-4" />,
                  label: "CCTP V2 Docs",
                  sub: "developers.circle.com",
                  href: "https://developers.circle.com/stablecoins/cctp-getting-started",
                  color: "#0047AB",
                },
              ].map((link) => (
                <a key={link.label} href={link.href} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-3 px-4 py-3 bg-white/[0.03] border border-white/[0.06] rounded-xl hover:border-white/10 transition-all group">
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{ background: `${link.color}18`, color: link.color }}>
                    {link.icon}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs text-white font-medium">{link.label}</p>
                    <p className="text-[10px] text-slate-600 truncate">{link.sub}</p>
                  </div>
                  <ExternalLink className="w-3 h-3 text-slate-600 group-hover:text-slate-400 ml-auto transition-colors flex-shrink-0" />
                </a>
              ))}
            </div>
          </div>
        </section>

      </main>
    </div>
  );
}
