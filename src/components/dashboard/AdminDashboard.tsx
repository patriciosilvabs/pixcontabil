import React, { useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils";
import { Link } from "react-router-dom";
import { useIsMobile } from "@/hooks/use-mobile";
import { MobileDashboard } from "@/components/dashboard/MobileDashboard";
import { usePixBalance } from "@/hooks/usePixBalance";
import { useDashboardData } from "@/hooks/useDashboardData";
import { Skeleton } from "@/components/ui/skeleton";
import { BarcodeScanner } from "@/components/payment/BarcodeScanner";
import { BoletoPaymentDrawer } from "@/components/payment/BoletoPaymentDrawer";
import { ManualBarcodeDialog } from "@/components/payment/ManualBarcodeDialog";
import { useBalanceVisibility } from "@/contexts/BalanceVisibilityContext";
import {
  DollarSign,
  TrendingDown,
  TrendingUp,
  Wallet,
  Send,
  AlertCircle,
  ArrowRight,
  FileWarning,
  PieChart,
  Inbox,
  RefreshCw,
} from "lucide-react";
import { PieChart as RechartsPie, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";

export function AdminDashboard() {
  const { profile, currentCompany, canViewBalance } = useAuth();
  const isMobile = useIsMobile();
  const { balanceVisible, toggleBalance } = useBalanceVisibility();
  const { balance, isLoading: balanceLoading, isAvailable: balanceAvailable, provider, refetch: refetchBalance, isRefetching: balanceRefetching } = usePixBalance();
  const { summary, categoryData, recentTransactions, missingReceipts, isLoading: dataLoading } = useDashboardData();

  const [barcodeScannerOpen, setBarcodeScannerOpen] = React.useState(false);
  const [scannedBarcode, setScannedBarcode] = React.useState("");
  const [boletoPaymentOpen, setBoletoPaymentOpen] = React.useState(false);
  const [manualBarcodeOpen, setManualBarcodeOpen] = React.useState(false);
  const preAcquiredStreamRef = useRef<MediaStream | null>(null);

  const handleBarcodeDetected = (barcode: string) => {
    setScannedBarcode(barcode);
    setBarcodeScannerOpen(false);
    setBoletoPaymentOpen(true);
  };

  if (isMobile) {
    return <MobileDashboard />;
  }

  const COLORS = ["#0088FE", "#00C49F", "#FFBB28", "#FF8042"];

  return (
    <div className="space-y-6 p-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Dashboard</h2>
          <p className="text-muted-foreground">
            Bem-vindo de volta, {profile?.full_name}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setManualBarcodeOpen(true)}>
            Pagar Boleto
          </Button>
          <Button onClick={() => setBarcodeScannerOpen(true)}>
            Escanear Boleto
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Saldo Disponível</CardTitle>
            <Wallet className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {balanceLoading ? (
                <Skeleton className="h-8 w-24" />
              ) : canViewBalance && balanceVisible ? (
                formatCurrency(balance)
              ) : (
                "••••••"
              )}
            </div>
            <div className="flex items-center gap-2 mt-2">
              <Button variant="ghost" size="sm" onClick={toggleBalance}>
                {balanceVisible ? "Ocultar" : "Mostrar"}
              </Button>
              <Button variant="ghost" size="sm" onClick={refetchBalance} disabled={balanceRefetching}>
                <RefreshCw className={`h-4 w-4 ${balanceRefetching ? "animate-spin" : ""}`} />
              </Button>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Entradas (Mês)</CardTitle>
            <TrendingUp className="h-4 w-4 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(summary?.total_inflow || 0)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Saídas (Mês)</CardTitle>
            <TrendingDown className="h-4 w-4 text-rose-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(summary?.total_outflow || 0)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Recibos Pendentes</CardTitle>
            <FileWarning className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{missingReceipts?.length || 0}</div>
            <p className="text-xs text-muted-foreground">Itens aguardando anexo</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        <Card className="col-span-4">
          <CardHeader>
            <CardTitle>Transações Recentes</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {recentTransactions?.map((tx: any) => (
                <div key={tx.id} className="flex items-center justify-between border-b pb-2 last:border-0">
                  <div className="flex items-center gap-4">
                    <div className={`p-2 rounded-full ${tx.type === 'in' ? 'bg-emerald-100' : 'bg-rose-100'}`}>
                      {tx.type === 'in' ? <TrendingUp className="h-4 w-4 text-emerald-600" /> : <TrendingDown className="h-4 w-4 text-rose-600" />}
                    </div>
                    <div>
                      <p className="font-medium">{tx.description}</p>
                      <p className="text-xs text-muted-foreground">{new Date(tx.created_at).toLocaleDateString()}</p>
                    </div>
                  </div>
                  <span className={`font-bold ${tx.type === 'in' ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {tx.type === 'in' ? '+' : '-'}{formatCurrency(tx.amount)}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
        <Card className="col-span-3">
          <CardHeader>
            <CardTitle>Distribuição de Gastos</CardTitle>
          </CardHeader>
          <CardContent className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <RechartsPie>
                <Pie
                  data={categoryData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={80}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {categoryData?.map((entry: any, index: number) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </RechartsPie>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <BarcodeScanner
        open={barcodeScannerOpen}
        onOpenChange={setBarcodeScannerOpen}
        onDetected={handleBarcodeDetected}
        preAcquiredStream={preAcquiredStreamRef.current}
      />
      <BoletoPaymentDrawer
        open={boletoPaymentOpen}
        onOpenChange={setBoletoPaymentOpen}
        barcode={scannedBarcode}
      />
      <ManualBarcodeDialog
        open={manualBarcodeOpen}
        onOpenChange={setManualBarcodeOpen}
      />
    </div>
  );
}
