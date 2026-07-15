import { useGetIndexerStats, getGetIndexerStatsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { Activity, Database, ArrowRightLeft, MessageSquare, Network } from "lucide-react";

export default function Overview() {
  const { data: stats, isLoading, isError } = useGetIndexerStats({
    query: {
      refetchInterval: 10000,
      queryKey: getGetIndexerStatsQueryKey(),
    }
  });

  if (isError) {
    return (
      <div className="p-6 md:p-8">
        <div className="bg-destructive/10 text-destructive border border-destructive/20 rounded-md p-4 flex items-center gap-3">
          <Activity className="w-5 h-5" />
          <p>Failed to load indexer stats. Please ensure the API is reachable.</p>
        </div>
      </div>
    );
  }

  const indexer = stats?.indexer;
  const burns = stats?.cctpBurnsByDestination || [];
  const mints = stats?.cctpMintsBySource || [];

  const StatCard = ({ title, value, icon: Icon, description }: { title: string, value: React.ReactNode, icon: any, description?: string }) => (
    <Card className="border-border/50 bg-card/50 backdrop-blur-sm shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <Icon className="w-4 h-4 text-primary/70" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold font-mono tracking-tight text-foreground">
          {isLoading ? <Skeleton className="h-8 w-24" /> : value}
        </div>
        {description && (
          <p className="text-xs text-muted-foreground mt-1">{description}</p>
        )}
      </CardContent>
    </Card>
  );

  return (
    <div className="p-6 md:p-8 max-w-[1600px] mx-auto space-y-8 animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Dashboard</h1>
        <p className="text-muted-foreground mt-1">Real-time overview of Arc Testnet activity.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard 
          title="Last Indexed Block" 
          value={indexer?.lastIndexedBlock?.toLocaleString() || "0"} 
          icon={Database} 
        />
        <StatCard 
          title="Total Transfers" 
          value={indexer?.totalTransfers?.toLocaleString() || "0"} 
          icon={ArrowRightLeft} 
        />
        <StatCard 
          title="Total Memos" 
          value={indexer?.totalMemos?.toLocaleString() || "0"} 
          icon={MessageSquare} 
        />
        <StatCard 
          title="CCTP Burns" 
          value={indexer?.totalCctpBurns?.toLocaleString() || "0"} 
          icon={Network} 
          description="Outgoing from Arc"
        />
        <StatCard 
          title="CCTP Mints" 
          value={indexer?.totalCctpMints?.toLocaleString() || "0"} 
          icon={Network} 
          description="Incoming to Arc"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="border-border/50">
          <CardHeader>
            <CardTitle>Burns by Destination</CardTitle>
            <CardDescription>Outgoing bridges from Arc Testnet</CardDescription>
          </CardHeader>
          <CardContent className="h-[300px]">
            {isLoading ? (
              <Skeleton className="w-full h-full" />
            ) : burns.length === 0 ? (
              <div className="h-full flex items-center justify-center text-muted-foreground border border-dashed border-border rounded-md">
                No burn data available
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={burns} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="domainName" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                  <RechartsTooltip 
                    cursor={{ fill: 'hsl(var(--secondary))' }}
                    contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', color: 'hsl(var(--foreground))' }}
                  />
                  <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} name="Transactions" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card className="border-border/50">
          <CardHeader>
            <CardTitle>Mints by Source</CardTitle>
            <CardDescription>Incoming bridges to Arc Testnet</CardDescription>
          </CardHeader>
          <CardContent className="h-[300px]">
            {isLoading ? (
              <Skeleton className="w-full h-full" />
            ) : mints.length === 0 ? (
              <div className="h-full flex items-center justify-center text-muted-foreground border border-dashed border-border rounded-md">
                No mint data available
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={mints} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="domainName" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                  <RechartsTooltip 
                    cursor={{ fill: 'hsl(var(--secondary))' }}
                    contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', color: 'hsl(var(--foreground))' }}
                  />
                  <Bar dataKey="count" fill="hsl(var(--chart-3))" radius={[4, 4, 0, 0]} name="Transactions" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
