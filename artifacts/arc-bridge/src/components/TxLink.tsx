import { ExternalLink } from "lucide-react";
import { ChainConfig } from "@/lib/chains";

interface TxLinkProps {
  hash: string;
  chain: ChainConfig;
  label?: string;
}

export function TxLink({ hash, chain, label }: TxLinkProps) {
  const url = `${chain.explorerUrl}/tx/${hash}`;
  const short = `${hash.slice(0, 8)}...${hash.slice(-6)}`;

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 text-xs text-[#4F9CF9] hover:text-[#7BB8FB] font-mono transition-colors"
    >
      {label ?? short}
      <ExternalLink className="w-3 h-3" />
    </a>
  );
}
