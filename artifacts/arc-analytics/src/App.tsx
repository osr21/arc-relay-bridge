import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { Layout } from "@/components/Layout";

// Lazy load pages for better bundle splitting, or just import them if small.
// Assuming we'll create them normally.
import Overview from "@/pages/Overview";
import Transfers from "@/pages/Transfers";
import Memos from "@/pages/Memos";
import Bridge from "@/pages/Bridge";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function Router() {
  return (
    <Switch>
      <Route path="/" component={Overview} />
      <Route path="/transfers" component={Transfers} />
      <Route path="/memos" component={Memos} />
      <Route path="/bridge" component={Bridge} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  const base = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
  
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={base}>
          <Layout>
            <Router />
          </Layout>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
