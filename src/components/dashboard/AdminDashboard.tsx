import React from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils";
import { Link } from "react-router-dom";
import { useIsMobile } from "@/hooks/use-mobile";
import { MobileDashboard } from "@/components/dashboard/MobileDashboard";
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
} from "lucide-react";
import { PieChart as RechartsPie, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";

// Mock data - will be replaced with real data from Supabase
const mockSummary = {
  totalBalance: 125430.50,
  totalCosts: 45230.00,
  totalExpenses: 28750.00,
  transactionsToday: 12,
  transactionsMonth: 156,
  pendingReceipts: 3,
};

const mockCategoryData = [
  { name: "Insumos", value: 25000, color: "hsl(270 91% 55%)" },
  { name: "Utilidades", value: 8500, color: "hsl(158 64% 52%)" },
  { name: "Ocupação", value: 12000, color: "hsl(43 96% 56%)" },
  { name: "Marketing", value: 4500, color: "hsl(200 80% 50%)" },
  { name: "Outros", value: 3980, color: "hsl(0 84% 60%)" },
];

const mockRecentTransactions = [
  {
    id: "1",
    beneficiary: "Moinho Santa Clara",
    amount: 2450.00,
    category: "Custos",
    time: "10 min atrás",
    status: "completed",
  },
  {
    id: "2",
    beneficiary: "CEMIG",
    amount: 1230.50,
    category: "Despesas",
    time: "1h atrás",
    status: "completed",
  },
  {
    id: "3",
    beneficiary: "Atacadão",
    amount: 3890.00,
    category: "Custos",
    time: "2h atrás",
    status: "pending",
  },
];

export function AdminDashboard() {
  const { profile, currentCompany } = useAuth();
  const isMobile = useIsMobile();
  const [balanceVisible, setBalanceVisible] = React.useState(true);

  if (isMobile) {
    return (
      <MobileDashboard
        balanceVisible={balanceVisible}
        onToggleBalance={() => setBalanceVisible((v) => !v)}
      />
    );
  }

  return (
    <div className="p-6 lg:p-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold">
            Olá, {profile?.full_name?.split(" ")[0]}! 👋
          </h1>
          <p className="text-muted-foreground">
            {currentCompany?.name} • Visão administrativa
          </p>
        </div>
        <Button asChild className="bg-gradient-primary hover:opacity-90 shadow-primary">
          <Link to="/pix/new">
            <Send className="mr-2 h-4 w-4" />
            Novo Pagamento Pix
          </Link>
        </Button>
      </div>

      {/* Alert for pending receipts */}
      {mockSummary.pendingReceipts > 0 && (
        <Card className="border-warning/50 bg-warning/5">
          <CardContent className="flex items-center gap-4 p-4">
            <div className="h-10 w-10 rounded-full bg-warning/20 flex items-center justify-center">
              <FileWarning className="h-5 w-5 text-warning" />
            </div>
            <div className="flex-1">
              <p className="font-medium">
                {mockSummary.pendingReceipts} comprovantes pendentes de classificação
              </p>
              <p className="text-sm text-muted-foreground">
                Classifique os comprovantes para manter a contabilidade em dia
              </p>
            </div>
            <Button variant="outline" size="sm" asChild>
              <Link to="/transactions?status=pending">
                Ver pendências
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Summary cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {/* Balance card */}
        <Card className="balance-card text-white overflow-hidden">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="h-10 w-10 rounded-lg bg-white/20 flex items-center justify-center">
                <Wallet className="h-5 w-5" />
              </div>
              <span className="text-xs bg-white/20 px-2 py-1 rounded-full">
                Saldo atual
              </span>
            </div>
            <p className="text-3xl font-bold font-mono-numbers">
              {formatCurrency(mockSummary.totalBalance)}
            </p>
            <p className="text-white/70 text-sm mt-1">
              Atualizado em tempo real
            </p>
          </CardContent>
        </Card>

        {/* Total outputs today */}
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="h-10 w-10 rounded-lg bg-accent-light flex items-center justify-center">
                <TrendingDown className="h-5 w-5 text-accent" />
              </div>
              <span className="text-xs bg-muted px-2 py-1 rounded-full text-muted-foreground">
                Hoje
              </span>
            </div>
            <p className="text-2xl font-bold font-mono-numbers">
              {formatCurrency(mockSummary.totalCosts + mockSummary.totalExpenses)}
            </p>
            <p className="text-muted-foreground text-sm mt-1">
              {mockSummary.transactionsToday} transações
            </p>
          </CardContent>
        </Card>

        {/* Costs */}
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="h-10 w-10 rounded-lg bg-primary-light flex items-center justify-center">
                <DollarSign className="h-5 w-5 text-primary" />
              </div>
              <span className="text-2xs font-medium text-primary bg-primary-light px-2 py-1 rounded-full">
                CUSTOS
              </span>
            </div>
            <p className="text-2xl font-bold font-mono-numbers">
              {formatCurrency(mockSummary.totalCosts)}
            </p>
            <p className="text-muted-foreground text-sm mt-1">
              Este mês
            </p>
          </CardContent>
        </Card>

        {/* Expenses */}
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="h-10 w-10 rounded-lg bg-destructive/10 flex items-center justify-center">
                <TrendingUp className="h-5 w-5 text-destructive" />
              </div>
              <span className="text-2xs font-medium text-destructive bg-destructive/10 px-2 py-1 rounded-full">
                DESPESAS
              </span>
            </div>
            <p className="text-2xl font-bold font-mono-numbers">
              {formatCurrency(mockSummary.totalExpenses)}
            </p>
            <p className="text-muted-foreground text-sm mt-1">
              Este mês
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Charts and transactions */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Category distribution */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <PieChart className="h-5 w-5 text-primary" />
              Distribuição por Categoria
            </CardTitle>
            <CardDescription>Gastos do mês atual</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <RechartsPie>
                  <Pie
                    data={mockCategoryData}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={80}
                    paddingAngle={2}
                    dataKey="value"
                  >
                    {mockCategoryData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value: number) => formatCurrency(value)}
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px",
                    }}
                  />
                </RechartsPie>
              </ResponsiveContainer>
            </div>
            <div className="space-y-2 mt-4">
              {mockCategoryData.map((item, index) => (
                <div key={index} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <div
                      className="h-3 w-3 rounded-full"
                      style={{ backgroundColor: item.color }}
                    />
                    <span className="text-muted-foreground">{item.name}</span>
                  </div>
                  <span className="font-medium font-mono-numbers">
                    {formatCurrency(item.value)}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Recent transactions */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Transações Recentes</CardTitle>
              <CardDescription>Últimos pagamentos realizados</CardDescription>
            </div>
            <Button variant="outline" size="sm" asChild>
              <Link to="/transactions">
                Ver todas
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {mockRecentTransactions.map((transaction) => (
                <div
                  key={transaction.id}
                  className="flex items-center justify-between p-4 rounded-lg bg-muted/50 hover:bg-muted transition-colors"
                >
                  <div className="flex items-center gap-4">
                    <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                      <DollarSign className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium">{transaction.beneficiary}</p>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <span
                          className={`px-2 py-0.5 rounded-full text-xs ${
                            transaction.category === "Custos"
                              ? "bg-primary/10 text-primary"
                              : "bg-destructive/10 text-destructive"
                          }`}
                        >
                          {transaction.category}
                        </span>
                        <span>•</span>
                        <span>{transaction.time}</span>
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-bold font-mono-numbers text-destructive">
                      - {formatCurrency(transaction.amount)}
                    </p>
                    {transaction.status === "pending" && (
                      <span className="text-xs text-warning flex items-center gap-1 justify-end">
                        <AlertCircle className="h-3 w-3" />
                        Pendente
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
