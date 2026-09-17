import { Switch, Route } from "wouter";
import BridgePage from "@/pages/BridgePage";
import YieldPage from "@/pages/YieldPage";
import PaymasterPage from "@/pages/PaymasterPage";
import RefuelPage from "@/pages/RefuelPage";
import PortfolioPage from "@/pages/PortfolioPage";
import EcosystemPage from "@/pages/EcosystemPage";
import DevelopersPage from "@/pages/DevelopersPage";
import NotFound from "@/pages/not-found";

/**
 * Isolated behind React.lazy in App.tsx. Its imports intentionally never
 * evaluate in a mainnet-preparing build because legacy pages reference
 * testnet-only chain keys at module scope.
 */
export default function TestnetApp() {
  return (
    <Switch>
      <Route path="/" component={BridgePage} />
      <Route path="/yield" component={YieldPage} />
      <Route path="/paymaster" component={PaymasterPage} />
      <Route path="/refuel" component={RefuelPage} />
      <Route path="/portfolio" component={PortfolioPage} />
      <Route path="/ecosystem" component={EcosystemPage} />
      <Route path="/developers" component={DevelopersPage} />
      <Route component={NotFound} />
    </Switch>
  );
}