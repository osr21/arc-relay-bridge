import { ExternalLink, Copy, CheckCheck, Terminal } from "lucide-react";
import { useState } from "react";

// ── Code block with copy ──────────────────────────────────────────────────────

function CodeBlock({ code, lang = "ts" }: { code: string; lang?: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(code.trim());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="relative group rounded-xl bg-[#0d1117] border border-white/[0.07] overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/[0.06] bg-white/[0.02]">
        <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider">{lang}</span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 text-[10px] text-slate-500 hover:text-slate-300 transition-colors"
        >
          {copied ? (
            <><CheckCheck className="w-3 h-3 text-emerald-400" /><span className="text-emerald-400">Copied</span></>
          ) : (
            <><Copy className="w-3 h-3" />Copy</>
          )}
        </button>
      </div>
      <pre className="overflow-x-auto p-4 text-xs leading-relaxed text-slate-300 font-mono whitespace-pre">
        <code>{code.trim()}</code>
      </pre>
    </div>
  );
}

function SectionHeader({ number, title, sub }: { number: string; title: string; sub: string }) {
  return (
    <div className="flex items-start gap-4">
      <div className="w-8 h-8 rounded-xl bg-white/[0.04] border border-white/[0.06] flex items-center justify-center flex-shrink-0 mt-0.5">
        <span className="text-xs font-bold text-slate-400">{number}</span>
      </div>
      <div>
        <h3 className="text-base font-semibold text-white">{title}</h3>
        <p className="text-xs text-slate-500 mt-0.5">{sub}</p>
      </div>
    </div>
  );
}

// ── Snippets ─────────────────────────────────────────────────────────────────

const INSTALL_BRIDGE = `# Bridge USDC across chains
npm install @circle-fin/bridge-kit @circle-fin/adapter-ethers-v6 ethers`;

const INSTALL_FULL = `# Full App Kit (Bridge + Swap + Unified Balance + Send)
npm install @circle-fin/app-kit @circle-fin/adapter-ethers-v6 ethers`;

const BRIDGE_SNIPPET = `import { AppKit } from "@circle-fin/app-kit";
import { ethersV6Adapter } from "@circle-fin/adapter-ethers-v6";
import { BrowserProvider } from "ethers";

// Create an adapter from the user's MetaMask provider
const provider = new BrowserProvider(window.ethereum);
const signer   = await provider.getSigner();
const adapter  = ethersV6Adapter({ signer });

const kit = new AppKit();

// Bridge 5.00 USDC from Ethereum Sepolia → Arc Testnet
const result = await kit.bridge({
  from: { adapter, chain: "Ethereum_Sepolia" },
  to:   { adapter, chain: "Arc_Testnet"      },
  amount: "5.00",
  token:  "USDC",
});

console.log("Burn tx:",  result.sourceTxHash);
console.log("Mint tx:",  result.destinationTxHash);`;

const BRIDGE_KIT_ONLY = `// Lighter install — Bridge Kit only (no Swap or Unified Balance)
import { BridgeKit } from "@circle-fin/bridge-kit";
import { ethersV6Adapter } from "@circle-fin/adapter-ethers-v6";

const kit    = new BridgeKit();
const result = await kit.bridge({
  from: { adapter, chain: "Ethereum_Sepolia" },
  to:   { adapter, chain: "Arc_Testnet"      },
  amount: "5.00",
  token:  "USDC",
});`;

const UNIFIED_BALANCE_SNIPPET = `import { AppKit } from "@circle-fin/app-kit";

const kit = new AppKit();

// Deposit from Base Sepolia into the Unified Balance
await kit.unifiedBalance.deposit({
  from: { adapter, chain: "Base_Sepolia" },
  amount: "10.00",
  token: "USDC",
});

// Spend on Arc Testnet — instantly, no bridging wait
await kit.unifiedBalance.spend({
  from: { adapter },
  to: {
    adapter,
    chain: "Arc_Testnet",
    recipientAddress: "0xYourRecipient",
  },
  amount: "10.00",
  token: "USDC",
});`;

const CUSTOM_CCTP_SNIPPET = `// This app's own bridge.ts — raw CCTP V2 integration
// Uses ethers.js v6 directly, no Circle SDK required.

import { ethers } from "ethers";
import { CHAINS } from "@/lib/chains";

const TOKEN_MESSENGER_ABI = ["function depositForBurn(uint256,uint32,bytes32,address,bytes32,uint256,uint32) returns (uint64)"];

async function burnUsdc(
  signer: ethers.Signer,
  fromChain: ChainConfig,
  toChain: ChainConfig,
  amountUnits: bigint,
  recipient: string,
) {
  const messenger = new ethers.Contract(
    fromChain.tokenMessenger,
    TOKEN_MESSENGER_ABI,
    signer,
  );

  const mintRecipient = ethers.zeroPadValue(recipient, 32);
  const destinationCaller = ethers.ZeroHash;   // anyone may relay

  // CCTP V2 — 7 parameters
  const tx = await messenger.depositForBurn(
    amountUnits,                      // amount (6 dec)
    toChain.cctpDomain,               // destinationDomain
    mintRecipient,                    // mintRecipient (bytes32)
    fromChain.usdcAddress,            // burnToken
    destinationCaller,                // destinationCaller (bytes32)
    0n,                               // maxFee
    fromChain.minFinalityThreshold ?? 1000, // minFinalityThreshold
  );
  return tx;
}`;

const PAYMASTER_SNIPPET = `// Deposit into the USDC paymaster so a smart account can
// transact on Arc without holding native gas tokens.

import { ethers } from "ethers";

const PAYMASTER_ABI = [
  "function deposit(address account, uint256 amount) external",
  "function balanceOf(address account) view returns (uint256 available, uint256 reserved)",
];

const ARC_PAYMASTER = "0xEE39e1690F1bE07e8a68813f57cE3142197CECf6";
const ARC_USDC      = "0x3600000000000000000000000000000000000000";

// Approve then deposit 5 USDC for the smart account
const usdc      = new ethers.Contract(ARC_USDC, ERC20_ABI, signer);
const paymaster = new ethers.Contract(ARC_PAYMASTER, PAYMASTER_ABI, signer);

await usdc.approve(ARC_PAYMASTER, 5_000_000n);        // 5 USDC (6 dec)
await paymaster.deposit(smartAccountAddress, 5_000_000n);`;

const GAS_RELAY_SNIPPET = `// Gas Relay mode: set mintRecipient = GasRelayer address.
// The relay API picks up the attestation and executes the mint
// on behalf of the user — no destination-chain gas needed.

const ARC_GAS_RELAYER = "0xf89773D7d9C43c01203793bf991e2550975a0C49";

const mintRecipient = ethers.zeroPadValue(ARC_GAS_RELAYER, 32);

await messenger.depositForBurn(
  amountUnits,
  toChain.cctpDomain,
  mintRecipient,     // <-- GasRelayer, not the user's wallet
  fromChain.usdcAddress,
  ethers.ZeroHash,
  0n,
  fromChain.minFinalityThreshold ?? 1000,
);

// Then notify the relay API with the burn tx hash:
await fetch("/api/relay/relay", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ burnTxHash, sourceChainId, destChainId }),
});`;

// ── Page ─────────────────────────────────────────────────────────────────────

export default function DevelopersPage() {
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
            <p className="text-slate-500 text-[11px] mt-0.5">Developer Reference</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <a href="/"           className="text-xs text-[#4F9CF9]  hover:text-blue-300   font-medium transition-colors">Bridge ↗</a>
          <a href="/portfolio"  className="text-xs text-cyan-400   hover:text-cyan-300   font-medium transition-colors">Portfolio ↗</a>
          <a href="/yield"      className="text-xs text-emerald-400 hover:text-emerald-300 font-medium transition-colors">Yield ↗</a>
          <a href="/paymaster"  className="text-xs text-violet-400 hover:text-violet-300  font-medium transition-colors">Paymaster ↗</a>
          <a href="/refuel"     className="text-xs text-orange-400 hover:text-orange-300  font-medium transition-colors">Refuel ↗</a>
          <a href="/ecosystem"  className="text-xs text-slate-400  hover:text-slate-200   font-medium transition-colors">Ecosystem ↗</a>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-10 space-y-14">

        {/* ── Hero ── */}
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
              <Terminal className="w-4 h-4 text-indigo-400" />
            </div>
            <h2 className="text-2xl font-bold text-white">Embed in your app</h2>
          </div>
          <p className="text-slate-400 text-sm leading-relaxed">
            This bridge is the <strong className="text-white">standalone UI</strong> — users arrive here directly and bridge
            without any SDK. For developers building their own app, Circle's{" "}
            <a href="https://www.npmjs.com/package/@circle-fin/bridge-kit"
              target="_blank" rel="noopener noreferrer"
              className="text-[#4F9CF9] hover:underline">
              App Kit
            </a>{" "}
            exposes the same CCTP flow behind a clean SDK. Both approaches are shown below.
          </p>

          {/* Package links */}
          <div className="flex flex-wrap gap-2">
            {[
              { label: "@circle-fin/app-kit",            href: "https://www.npmjs.com/package/@circle-fin/app-kit" },
              { label: "@circle-fin/bridge-kit",         href: "https://www.npmjs.com/package/@circle-fin/bridge-kit" },
              { label: "@circle-fin/adapter-ethers-v6",  href: "https://www.npmjs.com/package/@circle-fin/adapter-ethers-v6" },
              { label: "@circle-fin/unified-balance-kit",href: "https://www.npmjs.com/package/@circle-fin/unified-balance-kit" },
            ].map((p) => (
              <a key={p.label} href={p.href} target="_blank" rel="noopener noreferrer"
                className="px-3 py-1.5 bg-[#111827]/80 border border-white/[0.06] rounded-full text-xs font-mono text-slate-400 hover:text-[#4F9CF9] hover:border-[#4F9CF9]/30 transition-all flex items-center gap-1.5">
                {p.label} <ExternalLink className="w-2.5 h-2.5" />
              </a>
            ))}
          </div>
        </section>

        {/* ── Section 1: Bridge with Circle App Kit ── */}
        <section className="space-y-4">
          <SectionHeader
            number="1"
            title="Bridge USDC across chains — Circle App Kit"
            sub="Official Circle SDK · uses CCTP V2 under the hood · browser wallet via ethers.js adapter"
          />

          <div className="bg-[#111827]/80 border border-white/[0.06] rounded-2xl p-5 space-y-4">
            <div>
              <p className="text-xs font-semibold text-slate-400 mb-2">Install</p>
              <CodeBlock code={INSTALL_BRIDGE} lang="shell" />
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-400 mb-2">
                Bridge Ethereum Sepolia → Arc Testnet
              </p>
              <CodeBlock code={BRIDGE_SNIPPET} lang="typescript" />
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-400 mb-2">
                Lighter install — Bridge Kit standalone
              </p>
              <CodeBlock code={BRIDGE_KIT_ONLY} lang="typescript" />
            </div>
            <div className="flex items-center gap-2 pt-1">
              <a href="https://docs.arc.io/app-kit/quickstarts/bridge-tokens-across-blockchains"
                target="_blank" rel="noopener noreferrer"
                className="text-xs text-[#4F9CF9] hover:underline flex items-center gap-1">
                Bridge quickstart <ExternalLink className="w-3 h-3" />
              </a>
              <span className="text-slate-700">·</span>
              <a href="https://docs.arc.io/app-kit/references/supported-blockchains"
                target="_blank" rel="noopener noreferrer"
                className="text-xs text-[#4F9CF9] hover:underline flex items-center gap-1">
                Supported chains <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>
        </section>

        {/* ── Section 2: Unified Balance ── */}
        <section className="space-y-4">
          <SectionHeader
            number="2"
            title="Unified Balance — aggregate USDC across chains"
            sub="Circle Gateway · deposit from many chains, spend instantly on any · requires a Circle Console account"
          />

          <div className="bg-[#111827]/80 border border-white/[0.06] rounded-2xl p-5 space-y-4">
            <div className="px-3 py-2 bg-amber-500/10 border border-amber-500/20 rounded-xl text-xs text-amber-300">
              Unified Balance uses Circle Gateway, which requires a free Circle Console account for the backend API key.
              The Portfolio page in this app shows the same concept without Gateway, using direct RPC queries.
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-400 mb-2">
                Deposit from multiple chains, spend on Arc
              </p>
              <CodeBlock code={UNIFIED_BALANCE_SNIPPET} lang="typescript" />
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-400 mb-2">Install</p>
              <CodeBlock code={INSTALL_FULL} lang="shell" />
            </div>
            <div className="flex items-center gap-2 pt-1">
              <a href="https://docs.arc.io/app-kit/quickstarts/unified-balance-deposit-and-spend"
                target="_blank" rel="noopener noreferrer"
                className="text-xs text-[#4F9CF9] hover:underline flex items-center gap-1">
                Unified Balance quickstart <ExternalLink className="w-3 h-3" />
              </a>
              <span className="text-slate-700">·</span>
              <a href="https://developers.circle.com/gateway"
                target="_blank" rel="noopener noreferrer"
                className="text-xs text-[#4F9CF9] hover:underline flex items-center gap-1">
                Circle Gateway docs <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>
        </section>

        {/* ── Section 3: This app's raw CCTP implementation ── */}
        <section className="space-y-4">
          <SectionHeader
            number="3"
            title="Custom CCTP V2 — no SDK required"
            sub="This app's own bridge.ts · 7-param depositForBurn · direct ethers.js contract calls"
          />

          <div className="bg-[#111827]/80 border border-white/[0.06] rounded-2xl p-5 space-y-4">
            <p className="text-xs text-slate-500 leading-relaxed">
              If you prefer to talk to the CCTP contracts directly — no Circle SDK dependency — this is
              the pattern this bridge uses. The key difference from CCTP V1 is the 7-parameter{" "}
              <code className="text-slate-300 font-mono bg-white/[0.05] px-1 rounded">depositForBurn</code>{" "}
              (adds <code className="text-slate-300 font-mono bg-white/[0.05] px-1 rounded">destinationCaller</code>,{" "}
              <code className="text-slate-300 font-mono bg-white/[0.05] px-1 rounded">maxFee</code>, and{" "}
              <code className="text-slate-300 font-mono bg-white/[0.05] px-1 rounded">minFinalityThreshold</code>).
            </p>
            <CodeBlock code={CUSTOM_CCTP_SNIPPET} lang="typescript" />
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="px-3 py-2 bg-white/[0.03] border border-white/[0.05] rounded-xl">
                <p className="text-slate-500 font-medium">Arc finality threshold</p>
                <p className="text-white font-mono mt-0.5">2000 (finalized)</p>
              </div>
              <div className="px-3 py-2 bg-white/[0.03] border border-white/[0.05] rounded-xl">
                <p className="text-slate-500 font-medium">Others (Sepolia / Base / Fuji)</p>
                <p className="text-white font-mono mt-0.5">1000 (safe, ~1–2 min)</p>
              </div>
            </div>
          </div>
        </section>

        {/* ── Section 4: Paymaster ── */}
        <section className="space-y-4">
          <SectionHeader
            number="4"
            title="USDC Paymaster — gasless transactions on Arc"
            sub="ERC-4337 v0.7 · deployed on all 4 chains · deposit once, transact without native gas"
          />

          <div className="bg-[#111827]/80 border border-white/[0.06] rounded-2xl p-5 space-y-4">
            <CodeBlock code={PAYMASTER_SNIPPET} lang="typescript" />
            <div className="grid grid-cols-2 gap-3 text-xs">
              {[
                { chain: "Arc Testnet",      addr: "0xEE39e1690F1bE07e8a68813f57cE3142197CECf6" },
                { chain: "Ethereum Sepolia", addr: "0xe7ED22eF9Af9CAd98B048979dbd726e89dd0D417" },
                { chain: "Base Sepolia",     addr: "0x5f309aE9A9A364Ae18af77b7733bB9C43A032A4A" },
                { chain: "Avalanche Fuji",   addr: "0x0D3B7bd972F4Cc3CDAB62E1cFafcA79F8d7167f5" },
              ].map((r) => (
                <div key={r.chain} className="px-3 py-2 bg-white/[0.03] border border-white/[0.05] rounded-xl">
                  <p className="text-slate-500 font-medium">{r.chain}</p>
                  <p className="text-white font-mono mt-0.5 text-[10px] break-all">{r.addr}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Section 5: Gas Relay API ── */}
        <section className="space-y-4">
          <SectionHeader
            number="5"
            title="Gas Relay — bridge without destination gas"
            sub="GasRelayer contract + relay API · covers mint gas from the bridged amount"
          />

          <div className="bg-[#111827]/80 border border-white/[0.06] rounded-2xl p-5 space-y-4">
            <p className="text-xs text-slate-500 leading-relaxed">
              Set <code className="text-slate-300 font-mono bg-white/[0.05] px-1 rounded">mintRecipient</code> to the
              GasRelayer contract address instead of the user's wallet. The relay API detects the burn,
              waits for Circle attestation, and submits the mint on the user's behalf — deducting a small fee
              from the USDC amount.
            </p>
            <CodeBlock code={GAS_RELAY_SNIPPET} lang="typescript" />
            <div className="flex items-center gap-2 pt-1">
              <a href="/paymaster" className="text-xs text-violet-400 hover:underline flex items-center gap-1">
                Paymaster UI <ExternalLink className="w-3 h-3" />
              </a>
              <span className="text-slate-700">·</span>
              <a href="/refuel" className="text-xs text-orange-400 hover:underline flex items-center gap-1">
                Gas Refuel UI <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>
        </section>

        {/* ── Resources ── */}
        <section className="space-y-4">
          <h3 className="text-base font-semibold text-white">Resources</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[
              {
                title: "Arc Docs",
                sub: "docs.arc.io",
                href: "https://docs.arc.io",
                color: "#354457",
              },
              {
                title: "Circle CCTP V2",
                sub: "developers.circle.com",
                href: "https://developers.circle.com/stablecoins/cctp-getting-started",
                color: "#0047AB",
              },
              {
                title: "Circle App Kit",
                sub: "App Kit quickstarts",
                href: "https://docs.arc.io/app-kit",
                color: "#4F9CF9",
              },
              {
                title: "Circle Iris API",
                sub: "Attestation service",
                href: "https://iris-api-sandbox.circle.com/attestations",
                color: "#10b981",
              },
              {
                title: "ERC-4337 v0.7",
                sub: "Account abstraction spec",
                href: "https://eips.ethereum.org/EIPS/eip-4337",
                color: "#a78bfa",
              },
              {
                title: "Circle Faucet",
                sub: "Get testnet USDC",
                href: "https://faucet.circle.com",
                color: "#f59e0b",
              },
            ].map((r) => (
              <a key={r.title} href={r.href} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-3 px-4 py-3 bg-[#111827]/80 border border-white/[0.06] rounded-xl hover:border-white/10 transition-all group">
                <div className="w-6 h-6 rounded-lg flex-shrink-0"
                  style={{ background: `${r.color}22` }} />
                <div className="min-w-0">
                  <p className="text-xs text-white font-medium">{r.title}</p>
                  <p className="text-[10px] text-slate-600">{r.sub}</p>
                </div>
                <ExternalLink className="w-3 h-3 text-slate-600 group-hover:text-slate-400 ml-auto transition-colors flex-shrink-0" />
              </a>
            ))}
          </div>
        </section>

      </main>
    </div>
  );
}
