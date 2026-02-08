import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { AuthGuard } from "@/components/auth/AuthGuard";
import Auth from "./pages/Auth";
import Dashboard from "./pages/Dashboard";
import NewPix from "./pages/NewPix";
import ReceiptCapture from "./pages/ReceiptCapture";
import Transactions from "./pages/Transactions";
import Categories from "./pages/Categories";
import Reports from "./pages/Reports";
import Users from "./pages/Users";
import Companies from "./pages/Companies";
import Settings from "./pages/Settings";
import PixIntegration from "./pages/settings/PixIntegration";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            {/* Public routes */}
            <Route path="/auth" element={<Auth />} />
            
            {/* Protected routes */}
            <Route
              path="/"
              element={
                <AuthGuard>
                  <Dashboard />
                </AuthGuard>
              }
            />
            <Route
              path="/pix/new"
              element={
                <AuthGuard>
                  <NewPix />
                </AuthGuard>
              }
            />
            <Route
              path="/pix/receipt/:transactionId"
              element={
                <AuthGuard>
                  <ReceiptCapture />
                </AuthGuard>
              }
            />
            <Route
              path="/transactions"
              element={
                <AuthGuard>
                  <Transactions />
                </AuthGuard>
              }
            />
            <Route
              path="/categories"
              element={
                <AuthGuard requireAdmin>
                  <Categories />
                </AuthGuard>
              }
            />
            <Route
              path="/reports"
              element={
                <AuthGuard requireAdmin>
                  <Reports />
                </AuthGuard>
              }
            />
            <Route
              path="/users"
              element={
                <AuthGuard requireAdmin>
                  <Users />
                </AuthGuard>
              }
            />
            <Route
              path="/companies"
              element={
                <AuthGuard requireAdmin>
                  <Companies />
                </AuthGuard>
              }
            />
            <Route
              path="/settings"
              element={
                <AuthGuard>
                  <Settings />
                </AuthGuard>
              }
            />
            <Route
              path="/settings/pix-integration"
              element={
                <AuthGuard requireAdmin>
                  <PixIntegration />
                </AuthGuard>
              }
            />
            
            {/* Catch-all */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
