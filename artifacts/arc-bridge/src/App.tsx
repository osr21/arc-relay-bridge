import { Router as WouterRouter, useLocation } from "wouter";
import BridgePage from "@/pages/BridgePage";
import MainnetPreparationPage from "@/pages/MainnetPreparationPage";

function MainnetRouter() {
  const [location] = useLocation();
  if (location === "/" || location === "") return <BridgePage />;
  return <MainnetPreparationPage area={
      location.endsWith("/yield") ? "yield" :
      location.endsWith("/paymaster") ? "paymaster" :
      location.endsWith("/refuel") ? "refuel" :
      location.endsWith("/portfolio") ? "portfolio" :
      location.endsWith("/ecosystem") ? "ecosystem" :
      location.endsWith("/developers") ? "developers" :
      "bridge"
    } />;
}

function App() {
  return (
    <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
      <MainnetRouter />
    </WouterRouter>
  );
}

export default App;
