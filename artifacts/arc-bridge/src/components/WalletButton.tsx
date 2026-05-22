import { useState } from "react";
import { connectWallet, getWalletChainId } from "@/lib/bridge";
import { getChainById } from "@/lib/chains";
import { cn } from "@/lib/utils";

interface WalletButtonProps {
  address: string | null;
  chainId: number | null;
  onConnect: (address: string, chainId: number) => void;
  className?: string;
}

export function WalletButton({ address, chainId, onConnect, className }: WalletButtonProps) {
  const [loading, setLoading] = useState(false);

  const chain = chainId ? getChainById(chainId) : null;

  async function handleConnect() {
    setLoading(true);
    try {
      const addr = await connectWallet();
      const cid = await getWalletChainId();
      onConnect(addr, cid);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  function shortAddress(addr: string) {
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  }

  if (address) {
    return (
      <div className={cn("flex items-center gap-2", className)}>
        {chain && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-white/10 text-white border border-white/20">
            <span
              className="w-2 h-2 rounded-full"
              style={{ background: chain.logoColor }}
            />
            {chain.shortName}
          </div>
        )}
        <div className="px-3 py-1.5 rounded-full text-xs font-mono font-medium bg-white/10 text-white border border-white/20">
          {shortAddress(address)}
        </div>
      </div>
    );
  }

  return (
    <button
      onClick={handleConnect}
      disabled={loading}
      className={cn(
        "px-4 py-2 rounded-full text-sm font-semibold transition-all duration-200",
        "bg-[#4F9CF9] hover:bg-[#3B8AE8] text-white",
        "disabled:opacity-60 disabled:cursor-not-allowed",
        className
      )}
    >
      {loading ? "Connecting..." : "Connect Wallet"}
    </button>
  );
}
