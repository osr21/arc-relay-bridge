import { useState } from "react";
import { useGetCctpBurns, useGetCctpMints, getGetCctpBurnsQueryKey, getGetCctpMintsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AddressDisplay } from "@/components/AddressDisplay";
import { TxLink } from "@/components/TxLink";
import { formatAmount, getDomainName } from "@/lib/formatters";
import { ChevronLeft, ChevronRight, CheckCircle2, Clock, AlertCircle } from "lucide-react";

function BurnsTable() {
  const [page, setPage] = useState(1);
  const limit = 20;

  const queryParams = { page, limit };
  const { data, isLoading } = useGetCctpBurns(queryParams, {
    query: {
      queryKey: getGetCctpBurnsQueryKey(queryParams),
      placeholderData: (prev) => prev,
      refetchInterval: 10000,
    }
  });

  const burns = data?.data || [];
  const total = data?.total || 0;
  const totalPages = Math.ceil(total / limit);

  const StatusBadge = ({ status }: { status: string }) => {
    switch (status) {
      case "COMPLETE": 
        return <Badge variant="outline" className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20 gap-1"><CheckCircle2 className="w-3 h-3" /> Complete</Badge>;
      case "PENDING": 
        return <Badge variant="outline" className="bg-amber-500/10 text-amber-500 border-amber-500/20 gap-1"><Clock className="w-3 h-3" /> Pending</Badge>;
      case "STUCK": 
        return <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/20 gap-1"><AlertCircle className="w-3 h-3" /> Stuck</Badge>;
      default: 
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-border/50 overflow-hidden">
        <Table>
          <TableHeader className="bg-secondary/30">
            <TableRow>
              <TableHead>Status</TableHead>
              <TableHead>Tx Hash</TableHead>
              <TableHead>Depositor</TableHead>
              <TableHead>Destination</TableHead>
              <TableHead className="text-right">Amount (USDC)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && burns.length === 0 ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell><Skeleton className="h-6 w-20" /></TableCell>
                  <TableCell><Skeleton className="h-6 w-24" /></TableCell>
                  <TableCell><Skeleton className="h-6 w-32" /></TableCell>
                  <TableCell><Skeleton className="h-6 w-24" /></TableCell>
                  <TableCell className="text-right"><Skeleton className="h-6 w-20 ml-auto" /></TableCell>
                </TableRow>
              ))
            ) : burns.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-32 text-center text-muted-foreground">
                  No burn events found.
                </TableCell>
              </TableRow>
            ) : (
              burns.map((burn) => (
                <TableRow key={burn.id} className="hover:bg-secondary/20">
                  <TableCell><StatusBadge status={burn.attestationStatus} /></TableCell>
                  <TableCell><TxLink txHash={burn.txHash} /></TableCell>
                  <TableCell><AddressDisplay address={burn.depositor} /></TableCell>
                  <TableCell className="font-medium text-sm">{getDomainName(burn.destinationDomain)}</TableCell>
                  <TableCell className="text-right font-mono font-medium">
                    {formatAmount(burn.amount)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          Showing {(page - 1) * limit + 1} to {Math.min(page * limit, total)} of {total}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1 || isLoading}>
            <ChevronLeft className="w-4 h-4 mr-1" /> Prev
          </Button>
          <div className="text-sm font-medium px-2">Page {page} of {totalPages || 1}</div>
          <Button variant="outline" size="sm" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages || isLoading}>
            Next <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function MintsTable() {
  const [page, setPage] = useState(1);
  const limit = 20;

  const queryParams = { page, limit };
  const { data, isLoading } = useGetCctpMints(queryParams, {
    query: {
      queryKey: getGetCctpMintsQueryKey(queryParams),
      placeholderData: (prev) => prev,
      refetchInterval: 10000,
    }
  });

  const mints = data?.data || [];
  const total = data?.total || 0;
  const totalPages = Math.ceil(total / limit);

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-border/50 overflow-hidden">
        <Table>
          <TableHeader className="bg-secondary/30">
            <TableRow>
              <TableHead>Tx Hash</TableHead>
              <TableHead>Source Domain</TableHead>
              <TableHead>Recipient</TableHead>
              <TableHead className="text-right">Amount (USDC)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && mints.length === 0 ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell><Skeleton className="h-6 w-24" /></TableCell>
                  <TableCell><Skeleton className="h-6 w-24" /></TableCell>
                  <TableCell><Skeleton className="h-6 w-32" /></TableCell>
                  <TableCell className="text-right"><Skeleton className="h-6 w-20 ml-auto" /></TableCell>
                </TableRow>
              ))
            ) : mints.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="h-32 text-center text-muted-foreground">
                  No mint events found.
                </TableCell>
              </TableRow>
            ) : (
              mints.map((mint) => (
                <TableRow key={mint.id} className="hover:bg-secondary/20">
                  <TableCell><TxLink txHash={mint.txHash} /></TableCell>
                  <TableCell className="font-medium text-sm">{getDomainName(mint.remoteDomain)}</TableCell>
                  <TableCell><AddressDisplay address={mint.mintRecipient} /></TableCell>
                  <TableCell className="text-right font-mono font-medium">
                    {formatAmount(mint.amount)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          Showing {(page - 1) * limit + 1} to {Math.min(page * limit, total)} of {total}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1 || isLoading}>
            <ChevronLeft className="w-4 h-4 mr-1" /> Prev
          </Button>
          <div className="text-sm font-medium px-2">Page {page} of {totalPages || 1}</div>
          <Button variant="outline" size="sm" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages || isLoading}>
            Next <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function Bridge() {
  return (
    <div className="p-6 md:p-8 max-w-[1600px] mx-auto space-y-6 animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">CCTP Bridge Activity</h1>
        <p className="text-muted-foreground mt-1">Monitor cross-chain USDC transfers via CCTP.</p>
      </div>

      <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
        <CardContent className="pt-6">
          <Tabs defaultValue="burns" className="w-full">
            <TabsList className="mb-4">
              <TabsTrigger value="burns">Burns (Outgoing)</TabsTrigger>
              <TabsTrigger value="mints">Mints (Incoming)</TabsTrigger>
            </TabsList>
            <TabsContent value="burns" className="mt-0">
              <BurnsTable />
            </TabsContent>
            <TabsContent value="mints" className="mt-0">
              <MintsTable />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
