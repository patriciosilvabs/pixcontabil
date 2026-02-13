import { useEffect, useMemo } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Loader2 } from "lucide-react";

const PAGE_ROUTES: { pageKey: string; path: string }[] = [
  { pageKey: "dashboard", path: "/" },
  { pageKey: "new_payment", path: "/pix/new" },
  { pageKey: "transactions", path: "/transactions" },
  { pageKey: "categories", path: "/categories" },
  { pageKey: "reports", path: "/reports" },
  { pageKey: "users", path: "/users" },
  { pageKey: "companies", path: "/companies" },
  { pageKey: "settings", path: "/settings" },
];

interface AuthGuardProps {
  children: React.ReactNode;
  requireAdmin?: boolean;
  requiredPage?: string;
}

export function AuthGuard({ children, requireAdmin = false, requiredPage }: AuthGuardProps) {
  const { user, isLoading, isAdmin, hasPageAccess } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const firstAccessibleRoute = useMemo(() => {
    for (const route of PAGE_ROUTES) {
      if (hasPageAccess(route.pageKey)) return route.path;
    }
    return "/menu";
  }, [hasPageAccess]);

  useEffect(() => {
    if (!isLoading && !user) {
      navigate("/auth", { state: { from: location }, replace: true });
    }
  }, [user, isLoading, navigate, location]);

  useEffect(() => {
    if (!isLoading && user && requireAdmin && !isAdmin) {
      navigate(firstAccessibleRoute, { replace: true });
    }
  }, [user, isLoading, requireAdmin, isAdmin, navigate, firstAccessibleRoute]);

  useEffect(() => {
    if (!isLoading && user && requiredPage && !hasPageAccess(requiredPage)) {
      navigate(firstAccessibleRoute, { replace: true });
    }
  }, [user, isLoading, requiredPage, hasPageAccess, navigate, firstAccessibleRoute]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground">Carregando...</p>
        </div>
      </div>
    );
  }

  if (!user) return null;
  if (requireAdmin && !isAdmin) return null;
  if (requiredPage && !hasPageAccess(requiredPage)) return null;

  return <>{children}</>;
}
