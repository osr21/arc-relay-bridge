import { useState } from "react";
import { useGetMemos, getGetMemosQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AddressDisplay } from "@/components/AddressDisplay";
import { TxLink } from "@/components/TxLink";
import { ChevronLeft, ChevronRight, Search, FileText } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export default function Memos() {
  const [page, setPage] = useState(1);
  const [limit] = useState(25);
  const [sender, setSender] = useState("");
  const [target, setTarget] = useState("");

  const queryParams = {
    page,
    limit,
    sender: sender || undefined,
    target: target || undefined,
  };

  const { data, isLoading } = useGetMemos(queryParams, {
    query: {
      queryKey: getGetMemosQueryKey(queryParams),
      placeholderData: (prev) => prev,
    }
  });

  const memos = data?.data || [];
  const total = data?.total || 0;
  const totalPages = Math.ceil(total / limit);

  return (
    <div className="p-6 md:p-8 max-w-[1600px] mx-auto space-y-6 animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Memo Explorer</h1>
        <p className="text-muted-foreground mt-1">View on-chain arbitrary message events.</p>
      </div>

      <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
        <CardHeader className="pb-4">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input 
                placeholder="Sender Address..." 
                className="pl-9 font-mono text-sm"
                value={sender}
                onChange={(e) => { setSender(e.target.value); setPage(1); }}
              />
            </div>
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input 
                placeholder="Target Address..." 
                className="pl-9 font-mono text-sm"
                value={target}
                onChange={(e) => { setTarget(e.target.value); setPage(1); }}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border border-border/50 overflow-hidden">
            <Table>
              <TableHeader className="bg-secondary/30">
                <TableRow>
                  <TableHead>Tx Hash</TableHead>
                  <TableHead>Block</TableHead>
                  <TableHead>Sender</TableHead>
                  <TableHead>Target</TableHead>
                  <TableHead>Memo ID</TableHead>
                  <TableHead>Content</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && memos.length === 0 ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell><Skeleton className="h-6 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-6 w-16" /></TableCell>
                      <TableCell><Skeleton className="h-6 w-32" /></TableCell>
                      <TableCell><Skeleton className="h-6 w-32" /></TableCell>
                      <TableCell><Skeleton className="h-6 w-16" /></TableCell>
                      <TableCell><Skeleton className="h-6 w-48" /></TableCell>
                    </TableRow>
                  ))
                ) : memos.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                      No memos found matching your criteria.
                    </TableCell>
                  </TableRow>
                ) : (
                  memos.map((memo) => (
                    <TableRow key={memo.id} className="hover:bg-secondary/20">
                      <TableCell><TxLink txHash={memo.txHash} /></TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{memo.blockNumber}</TableCell>
                      <TableCell><AddressDisplay address={memo.sender} /></TableCell>
                      <TableCell><AddressDisplay address={memo.target} /></TableCell>
                      <TableCell className="font-mono text-xs">{memo.memoId}</TableCell>
                      <TableCell>
                        {memo.memoText ? (
                          <div className="flex items-center gap-2 text-sm text-foreground max-w-xs truncate">
                            <FileText className="w-4 h-4 text-primary shrink-0" />
                            <span className="truncate">{memo.memoText}</span>
                          </div>
                        ) : (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div className="text-xs font-mono text-muted-foreground max-w-[120px] truncate cursor-help">
                                {memo.memoData}
                              </div>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p className="font-mono text-xs max-w-sm break-all">{memo.memoData}</p>
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          
          <div className="flex items-center justify-between mt-4">
            <div className="text-sm text-muted-foreground">
              {total > 0
                ? <>Showing {(page - 1) * limit + 1}–{Math.min(page * limit, total)} of {total.toLocaleString()}</>
                : null}
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
