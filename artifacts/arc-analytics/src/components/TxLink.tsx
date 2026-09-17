import { ExternalLink } from "lucide-react";

export function TxLink({ txHash }: { txHash: string }) {
  if (!txHash) return null;
  
  const shortHash = `${txHash.slice(0, 6)}...${txHash.slice(-4)}`;
  
  return (
    <a
      href={`https://testnet.arcscan.app/tx/${txHash}`}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded hover:bg-accent hover:text-accent-foreground text-primary transition-colors text-xs font-mono"
      onClick={(e) => e.stopPropagation()}
    >
      <span>{shortHash}</span>
      <ExternalLink className="w-3 h-3 opacity-70" />
    </a>
  );
}
