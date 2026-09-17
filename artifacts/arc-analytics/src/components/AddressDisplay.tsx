import { useToast } from "@/hooks/use-toast";
import { formatAddress } from "@/lib/formatters";
import { Copy } from "lucide-react";

export function AddressDisplay({ address }: { address: string }) {
  const { toast } = useToast();

  const handleCopy = () => {
    navigator.clipboard.writeText(address);
    toast({
      description: "Address copied to clipboard",
      duration: 2000,
    });
  };

  return (
    <div 
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-secondary/50 hover:bg-secondary cursor-pointer transition-colors text-xs font-mono text-secondary-foreground"
      onClick={handleCopy}
      title={address}
    >
      <span>{formatAddress(address)}</span>
      <Copy className="w-3 h-3 text-muted-foreground" />
    </div>
  );
}
