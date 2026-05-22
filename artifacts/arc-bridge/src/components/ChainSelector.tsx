import { useState, useRef, useEffect } from "react";
import { ChainConfig, CHAIN_LIST, CHAINS } from "@/lib/chains";
import { cn } from "@/lib/utils";
import { ChevronDown } from "lucide-react";

interface ChainSelectorProps {
  label: string;
  selected: ChainConfig;
  exclude?: ChainConfig;
  onChange: (chain: ChainConfig) => void;
  disabled?: boolean;
}

const CHAIN_ICONS: Record<number, string> = {
  5042002: "⬡",
  11155111: "Ξ",
  84532: "⬟",
  43113: "△",
};

export function ChainSelector({ label, selected, exclude, onChange, disabled }: ChainSelectorProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const options = CHAIN_LIST.filter((c) => c.id !== exclude?.id);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div ref={ref} className="relative">
      <div className="text-xs text-slate-400 font-medium uppercase tracking-widest mb-2">{label}</div>
      <button
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
        className={cn(
          "w-full flex items-center justify-between gap-3 px-4 py-3 rounded-xl",
          "bg-slate-800/60 border border-slate-700/60 hover:border-slate-600 transition-all duration-150",
          "disabled:opacity-50 disabled:cursor-not-allowed",
          open && "border-[#4F9CF9]/60 bg-slate-800"
        )}
      >
        <div className="flex items-center gap-3">
          <span
            className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-white"
            style={{ background: selected.logoColor }}
          >
            {CHAIN_ICONS[selected.id] ?? "○"}
          </span>
          <div className="text-left">
            <div className="text-sm font-semibold text-white">{selected.name}</div>
            <div className="text-xs text-slate-400">CCTP Domain #{selected.cctpDomain}</div>
          </div>
        </div>
        <ChevronDown className={cn("w-4 h-4 text-slate-400 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="absolute z-20 top-full mt-2 w-full bg-slate-900 border border-slate-700 rounded-xl shadow-2xl overflow-hidden">
          {options.map((chain) => (
            <button
              key={chain.id}
              onClick={() => { onChange(chain); setOpen(false); }}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-800 transition-colors text-left",
                selected.id === chain.id && "bg-slate-800/50"
              )}
            >
              <span
                className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                style={{ background: chain.logoColor }}
              >
                {CHAIN_ICONS[chain.id] ?? "○"}
              </span>
              <div>
                <div className="text-sm font-semibold text-white">{chain.name}</div>
                <div className="text-xs text-slate-400">CCTP Domain #{chain.cctpDomain}</div>
              </div>
              {selected.id === chain.id && (
                <div className="ml-auto w-2 h-2 rounded-full bg-[#4F9CF9]" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
