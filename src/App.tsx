import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { BalanceVisibilityProvider } from "@/contexts/BalanceVisibilityContext";
import { AuthGuard } from "@/components/auth/AuthGuard";
import { Loader2 } from "lucide-react";

// Lazy-loaded pages for code splitting — reduces initial bundle
const Auth = lazy(() => import("./pages/Auth"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const NewPayment = lazy(() => import("./pages/NewPayment"));
const ReceiptCapture = lazy(() => import("./pages/ReceiptCapture"));
const Transactions = lazy(() => import("./pages/Transactions"));
const Categories = lazy(() => import("./pages/Categories"));
const Reports = lazy(() => import("./pages/Reports"));
const Users = lazy(() => import("./pages/Users"));
const Companies = lazy(() => import("./pages/Companies"));
const Settings = lazy(() => import("./pages/Settings"));
const PixIntegration = lazy(() => import("./pages/settings/PixIntegration"));
const BatchPayment = lazy(() => import("./pages/BatchPayment"));
const MobileMenu = lazy(() => import("./pages/MobileMenu"));
const WebhookEvents = lazy(() => import("./pages/WebhookEvents"));
const NotFound = lazy(() => import("./pages/NotFound"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      staleTime: 5 * 60 * 1000, // 5 min
      retry: 1,
    },
  },
});

function PageFallback() {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <BalanceVisibilityProvider>
          <Suspense fallback={<PageFallback />}>
          <Routes>
            <Route path="/auth" element={<Auth />} />

            <Route path="/" element={<AuthGuard><Dashboard /></AuthGuard>} />
            <Route path="/pix/new" element={<AuthGuard requiredPage="new_payment"><NewPayment /></AuthGuard>} />
            <Route path="/pix/receipt/:transactionId" element={<AuthGuard><ReceiptCapture /></AuthGuard>} />
            <Route path="/transactions" element={<AuthGuard requiredPage="transactions"><Transactions /></AuthGuard>} />
            <Route path="/categories" element={<AuthGuard requireAdmin requiredPage="categories"><Categories /></AuthGuard>} />
            <Route path="/reports" element={<AuthGuard requireAdmin requiredPage="reports"><Reports /></AuthGuard>} />
            <Route path="/users" element={<AuthGuard requireAdmin requiredPage="users"><Users /></AuthGuard>} />
            <Route path="/companies" element={<AuthGuard requireAdmin requiredPage="companies"><Companies /></AuthGuard>} />
            <Route path="/settings" element={<AuthGuard requiredPage="settings"><Settings /></AuthGuard>} />
            <Route path="/settings/pix-integration" element={<AuthGuard requireAdmin><PixIntegration /></AuthGuard>} />
            <Route path="/batch-payment" element={<AuthGuard requiredPage="new_payment"><BatchPayment /></AuthGuard>} />
            <Route path="/menu" element={<AuthGuard><MobileMenu /></AuthGuard>} />
            <Route path="/webhook-events" element={<AuthGuard requireAdmin><WebhookEvents /></AuthGuard>} />

            <Route path="*" element={<NotFound />} />
          </Routes>
          </Suspense>
          </BalanceVisibilityProvider>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
