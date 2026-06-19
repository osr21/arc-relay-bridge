import { Switch, Route, Router as WouterRouter } from "wouter";
import BridgePage     from "@/pages/BridgePage";
import YieldPage      from "@/pages/YieldPage";
import PaymasterPage  from "@/pages/PaymasterPage";
import RefuelPage     from "@/pages/RefuelPage";
import PortfolioPage  from "@/pages/PortfolioPage";
import EcosystemPage  from "@/pages/EcosystemPage";
import DevelopersPage from "@/pages/DevelopersPage";
import NotFound       from "@/pages/not-found";

function Router() {
  return (
    <Switch>
      <Route path="/"           component={BridgePage}     />
      <Route path="/yield"      component={YieldPage}      />
      <Route path="/paymaster"  component={PaymasterPage}  />
      <Route path="/refuel"     component={RefuelPage}     />
      <Route path="/portfolio"  component={PortfolioPage}  />
      <Route path="/ecosystem"  component={EcosystemPage}  />
      <Route path="/developers" component={DevelopersPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
      <Router />
    </WouterRouter>
  );
}

export default App;
