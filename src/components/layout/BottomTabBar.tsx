import { Link, useLocation } from "react-router-dom";
import { Home, LayoutGrid, ArrowLeftRight, PlusCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";

const allTabs = [
  { name: "Home", href: "/", icon: Home, pageKey: "dashboard" },
  { name: "Novo Pix", href: "/pix/new", icon: PlusCircle, pageKey: "new_payment" },
  { name: "Menu", href: "/menu", icon: LayoutGrid },
  { name: "Transações", href: "/transactions", icon: ArrowLeftRight, pageKey: "transactions" },
];

export function BottomTabBar() {
  const { hasPageAccess } = useAuth();
  const location = useLocation();
  const tabs = allTabs.filter(t => !t.pageKey || hasPageAccess(t.pageKey));
  const isActive = (href: string) => {
    if (href === "/") return location.pathname === "/";
    return location.pathname.startsWith(href);
  };

  return (
    <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-card border-t border-border safe-area-bottom">
      <div className="flex items-center justify-around h-16">
        {tabs.map((tab) => {
          const active = isActive(tab.href);
          const isHome = tab.href === "/";

          return (
            <Link
              key={tab.href}
              to={tab.href}
              className={cn(
                "flex flex-col items-center justify-center gap-0.5 flex-1 h-full transition-colors",
                active ? "text-primary" : "text-muted-foreground"
              )}
            >
              {isHome && active ? (
                <div className="w-12 h-12 -mt-6 rounded-full bg-gradient-bank-header flex items-center justify-center shadow-lg border-4 border-card">
                  <tab.icon className="h-5 w-5 text-white" />
                </div>
              ) : (
                <tab.icon className={cn("h-6 w-6", active && "text-primary")} />
              )}
              <span className={cn("text-[10px] font-medium", isHome && active && "mt-0.5")}>
                {tab.name}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
