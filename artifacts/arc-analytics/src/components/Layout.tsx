import { Link, useLocation } from "wouter";
import { 
  Activity, 
  ArrowRightLeft, 
  MessageSquare, 
  Network,
  Menu,
  TerminalSquare
} from "lucide-react";
import { useState } from "react";
import { Button } from "./ui/button";
import { Sheet, SheetContent, SheetTrigger } from "./ui/sheet";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/", label: "Overview", icon: Activity },
  { href: "/transfers", label: "USDC Transfers", icon: ArrowRightLeft },
  { href: "/memos", label: "Memos", icon: MessageSquare },
  { href: "/bridge", label: "CCTP Bridge", icon: Network },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  const NavLinks = () => (
    <>
      {NAV_ITEMS.map((item) => {
        const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
        const Icon = item.icon;
        
        return (
          <Link key={item.href} href={item.href} onClick={() => setMobileOpen(false)}>
            <div className={cn(
              "flex items-center gap-3 px-3 py-2 rounded-md transition-colors cursor-pointer text-sm font-medium",
              isActive 
                ? "bg-primary/15 text-primary" 
                : "text-muted-foreground hover:bg-secondary hover:text-foreground"
            )}>
              <Icon className="w-4 h-4" />
              {item.label}
            </div>
          </Link>
        );
      })}
    </>
  );

  return (
    <div className="min-h-[100dvh] flex flex-col md:flex-row bg-background">
      {/* Mobile Header */}
      <header className="md:hidden flex items-center justify-between p-4 border-b border-border bg-card">
        <div className="flex items-center gap-2 font-bold text-primary">
          <TerminalSquare className="w-5 h-5" />
          <span>Arc Analytics</span>
        </div>
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="md:hidden">
              <Menu className="w-5 h-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-64 bg-card border-r-border p-0">
            <div className="p-4 border-b border-border">
              <div className="flex items-center gap-2 font-bold text-primary">
                <TerminalSquare className="w-6 h-6" />
                <span>Arc Analytics</span>
              </div>
            </div>
            <nav className="p-4 flex flex-col gap-1">
              <NavLinks />
            </nav>
          </SheetContent>
        </Sheet>
      </header>

      {/* Desktop Sidebar */}
      <aside className="hidden md:flex w-64 flex-col border-r border-border bg-card shrink-0">
        <div className="p-6 border-b border-border">
          <div className="flex items-center gap-2 font-bold text-xl text-primary">
            <TerminalSquare className="w-6 h-6" />
            <span>Arc Analytics</span>
          </div>
          <div className="text-xs text-muted-foreground mt-1 font-mono">TESTNET EXPLORER</div>
        </div>
        <nav className="flex-1 p-4 flex flex-col gap-1">
          <NavLinks />
        </nav>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-x-hidden min-w-0">
        {children}
      </main>
    </div>
  );
}
