import { useState } from "react";
import { ExternalLink, Copy, Check } from "lucide-react";
import { ChainConfig } from "@/lib/chains";

interface TxLinkProps {
  hash: string;
  chain: ChainConfig;
  label?: string;
}

export function TxLink({ hash, chain, label }: TxLinkProps) {
  const [copied, setCopied] = useState(false);
  const short = label ?? `${hash.slice(0, 8)}...${hash.slice(-6)}`;

  if (!chain.explorerUrl) {
    const handleCopy = () => {
      navigator.clipboard.writeText(hash).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    };
    return (
      <button
        onClick={handleCopy}
        title="No block explorer available — click to copy tx hash"
        className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 font-mono transition-colors cursor-pointer"
      >
        {short}
        {copied ? (
          <Check className="w-3 h-3 text-green-400" />
        ) : (
          <Copy className="w-3 h-3" />
        )}
      </button>
    );
  }

  const url = `${chain.explorerUrl}/tx/${hash}`;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 text-xs text-[#4F9CF9] hover:text-[#7BB8FB] font-mono transition-colors"
    >
      {short}
      <ExternalLink className="w-3 h-3" />
    </a>
  );
}
