import { useState } from "react";
import { useGetTransfers, getGetTransfersQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AddressDisplay } from "@/components/AddressDisplay";
import { TxLink } from "@/components/TxLink";
import { formatAmount } from "@/lib/formatters";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";

export default function Transfers() {
  const [page, setPage] = useState(1);
  const [limit] = useState(25);
  const [fromAddress, setFromAddress] = useState("");
  const [toAddress, setToAddress] = useState("");
  const [type, setType] = useState<string>("ALL");

  // Debounced values for query (simplified for now, ideally use a hook)
  const queryParams = {
    page,
    limit,
    from: fromAddress || undefined,
    to: toAddress || undefined,
    type: type !== "ALL" ? (type as any) : undefined,
  };

  const { data, isLoading } = useGetTransfers(queryParams, {
    query: {
      queryKey: getGetTransfersQueryKey(queryParams),
      placeholderData: (prev) => prev, // Keep previous data while fetching
    }
  });

  const transfers = data?.data || [];
  const total = data?.total || 0;
  const totalPages = Math.ceil(total / limit);

  const TypeBadge = ({ type }: { type: string }) => {
    switch (type) {
      case "MINT": return <Badge variant="outline" className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20">MINT</Badge>;
      case "BURN": return <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/20">BURN</Badge>;
      case "NATIVE_SEND": return <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20">SEND</Badge>;
      default: return <Badge variant="outline">{type}</Badge>;
    }
  };

  return (
    <div className="p-6 md:p-8 max-w-[1600px] mx-auto space-y-6 animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">USDC Transfers</h1>
        <p className="text-muted-foreground mt-1">Explore native USDC transfers on Arc Testnet.</p>
      </div>

      <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
        <CardHeader className="pb-4">
          <div className="flex flex-col md:flex-row gap-4 items-end md:items-center justify-between">
            <div className="flex-1 w-full grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input 
                  placeholder="From Address..." 
                  className="pl-9 font-mono text-sm"
                  value={fromAddress}
                  onChange={(e) => { setFromAddress(e.target.value); setPage(1); }}
                />
              </div>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input 
                  placeholder="To Address..." 
                  className="pl-9 font-mono text-sm"
                  value={toAddress}
                  onChange={(e) => { setToAddress(e.target.value); setPage(1); }}
                />
              </div>
              <Select value={type} onValueChange={(v) => { setType(v); setPage(1); }}>
                <SelectTrigger>
                  <SelectValue placeholder="All Types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Types</SelectItem>
                  <SelectItem value="NATIVE_SEND">Native Send</SelectItem>
                  <SelectItem value="MINT">Mint</SelectItem>
                  <SelectItem value="BURN">Burn</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border border-border/50 overflow-hidden">
            <Table>
              <TableHeader className="bg-secondary/30">
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Tx Hash</TableHead>
                  <TableHead>Block</TableHead>
                  <TableHead>From</TableHead>
                  <TableHead>To</TableHead>
                  <TableHead className="text-right">Amount (USDC)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && transfers.length === 0 ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell><Skeleton className="h-6 w-16" /></TableCell>
                      <TableCell><Skeleton className="h-6 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-6 w-16" /></TableCell>
                      <TableCell><Skeleton className="h-6 w-32" /></TableCell>
                      <TableCell><Skeleton className="h-6 w-32" /></TableCell>
                      <TableCell className="text-right"><Skeleton className="h-6 w-20 ml-auto" /></TableCell>
                    </TableRow>
                  ))
                ) : transfers.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                      No transfers found matching your criteria.
                    </TableCell>
                  </TableRow>
                ) : (
                  transfers.map((tx) => (
                    <TableRow key={tx.id} className="hover:bg-secondary/20">
                      <TableCell><TypeBadge type={tx.transferType} /></TableCell>
                      <TableCell><TxLink txHash={tx.txHash} /></TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{tx.blockNumber}</TableCell>
                      <TableCell><AddressDisplay address={tx.fromAddress} /></TableCell>
                      <TableCell><AddressDisplay address={tx.toAddress} /></TableCell>
                      <TableCell className="text-right font-mono font-medium">
                        {formatAmount(tx.amountUsdc)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          
          <div className="flex items-center justify-between mt-4">
            <div className="text-sm text-muted-foreground">
              Showing {(page - 1) * limit + 1} to {Math.min(page * limit, total)} of {total}
            </div>
            <div className="flex items-center gap-2">
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1 || isLoading}
              >
                <ChevronLeft className="w-4 h-4 mr-1" /> Prev
              </Button>
              <div className="text-sm font-medium px-2">Page {page} of {totalPages || 1}</div>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages || isLoading}
              >
                Next <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
