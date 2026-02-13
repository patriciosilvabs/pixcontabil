import { useState, useEffect, useMemo } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Loader2, FileText, Download, TrendingDown, DollarSign } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";
import { startOfMonth, endOfMonth, subMonths, format, startOfWeek, endOfWeek, startOfDay, endOfDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import { exportCSV, exportXLSX, exportPDF } from "@/utils/reportExports";
import { toast } from "sonner";

type PeriodFilter = "today" | "week" | "month" | "last3months";

const COLORS = ["hsl(270, 91%, 55%)", "hsl(158, 64%, 52%)", "hsl(43, 96%, 56%)", "hsl(0, 84%, 60%)", "hsl(200, 70%, 50%)"];

export default function Reports() {
  const { currentCompany } = useAuth();
  const [transactions, setTransactions] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [period, setPeriod] = useState<PeriodFilter>("month");

  const dateRange = useMemo(() => {
    const now = new Date();
    switch (period) {
      case "today": return { start: startOfDay(now), end: endOfDay(now) };
      case "week": return { start: startOfWeek(now, { locale: ptBR }), end: endOfWeek(now, { locale: ptBR }) };
      case "month": return { start: startOfMonth(now), end: endOfMonth(now) };
      case "last3months": return { start: startOfMonth(subMonths(now, 2)), end: endOfMonth(now) };
    }
  }, [period]);

  useEffect(() => {
    if (!currentCompany) return;
    const fetchData = async () => {
      setIsLoading(true);
      const [txRes, catRes] = await Promise.all([
        supabase
          .from("transactions")
          .select("*, categories(name, classification), receipts(file_url, file_name)")
          .eq("company_id", currentCompany.id)
          .gte("created_at", dateRange.start.toISOString())
          .lte("created_at", dateRange.end.toISOString())
          .order("created_at", { ascending: false }),
        supabase.from("categories").select("*").eq("company_id", currentCompany.id),
      ]);
      if (txRes.data) setTransactions(txRes.data);
      if (catRes.data) setCategories(catRes.data);
      setIsLoading(false);
    };
    fetchData();
  }, [currentCompany, dateRange]);

  const totalAmount = transactions.reduce((s, t) => s + Number(t.amount), 0);
  const totalCosts = transactions.filter((t) => t.categories?.classification === "cost").reduce((s, t) => s + Number(t.amount), 0);
  const totalExpenses = transactions.filter((t) => t.categories?.classification === "expense").reduce((s, t) => s + Number(t.amount), 0);

  const byCategory = useMemo(() => {
    const map: Record<string, { name: string; value: number }> = {};
    transactions.forEach((t) => {
      const name = t.categories?.name || "Sem categoria";
      if (!map[name]) map[name] = { name, value: 0 };
      map[name].value += Number(t.amount);
    });
    return Object.values(map).sort((a, b) => b.value - a.value);
  }, [transactions]);

  const pieData = [
    { name: "Custos", value: totalCosts },
    { name: "Despesas", value: totalExpenses },
    { name: "Sem classificação", value: totalAmount - totalCosts - totalExpenses },
  ].filter((d) => d.value > 0);

  const formatCurrency = (v: number) => `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;

  const periodLabels: Record<PeriodFilter, string> = {
    today: "Hoje",
    week: "Esta Semana",
    month: "Este Mês",
    last3months: "Últimos 3 Meses",
  };

  const handleExportPDF = async () => {
    toast.info("Gerando PDF com comprovantes…");
    await exportPDF(transactions, { totalAmount, totalCosts, totalExpenses }, currentCompany?.name || "", periodLabels[period]);
    toast.success("PDF gerado!");
  };

  return (
    <MainLayout>
      <div className="p-6 lg:p-8 max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <FileText className="h-6 w-6 text-primary" /> Relatórios
            </h1>
            <p className="text-muted-foreground">Resumo financeiro da empresa</p>
          </div>
          <div className="flex gap-2">
            <Select value={period} onValueChange={(v) => setPeriod(v as PeriodFilter)}>
              <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="today">Hoje</SelectItem>
                <SelectItem value="week">Esta Semana</SelectItem>
                <SelectItem value="month">Este Mês</SelectItem>
                <SelectItem value="last3months">Últimos 3 Meses</SelectItem>
              </SelectContent>
            </Select>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" disabled={transactions.length === 0}>
                  <Download className="h-4 w-4 mr-2" /> Exportar
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onClick={() => exportCSV(transactions)}>CSV</DropdownMenuItem>
                <DropdownMenuItem onClick={() => exportXLSX(transactions)}>XLSX</DropdownMenuItem>
                <DropdownMenuItem onClick={handleExportPDF}>PDF com Comprovantes</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {isLoading ? (
          <div className="flex justify-center p-12"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
        ) : (
          <>
            {/* Summary Cards */}
            <div className="grid gap-4 md:grid-cols-3 mb-6">
              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                      <DollarSign className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Total Saídas</p>
                      <p className="text-xl font-bold font-mono-numbers">{formatCurrency(totalAmount)}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-lg bg-destructive/10 flex items-center justify-center">
                      <TrendingDown className="h-5 w-5 text-destructive" />
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Custos</p>
                      <p className="text-xl font-bold font-mono-numbers">{formatCurrency(totalCosts)}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-lg bg-warning/10 flex items-center justify-center">
                      <TrendingDown className="h-5 w-5 text-warning" />
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Despesas</p>
                      <p className="text-xl font-bold font-mono-numbers">{formatCurrency(totalExpenses)}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Charts */}
            <div className="grid gap-6 md:grid-cols-2 mb-6">
              <Card>
                <CardHeader><CardTitle className="text-base">Por Categoria</CardTitle></CardHeader>
                <CardContent>
                  {byCategory.length > 0 ? (
                    <ResponsiveContainer width="100%" height={250}>
                      <BarChart data={byCategory.slice(0, 8)}>
                        <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`} />
                        <Tooltip formatter={(v: number) => formatCurrency(v)} />
                        <Bar dataKey="value" fill="hsl(270, 91%, 55%)" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <p className="text-center text-muted-foreground py-8">Sem dados</p>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-base">Custos vs Despesas</CardTitle></CardHeader>
                <CardContent>
                  {pieData.length > 0 ? (
                    <ResponsiveContainer width="100%" height={250}>
                      <PieChart>
                        <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                          {pieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                        </Pie>
                        <Tooltip formatter={(v: number) => formatCurrency(v)} />
                        <Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : (
                    <p className="text-center text-muted-foreground py-8">Sem dados</p>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Transactions Table */}
            <Card>
              <CardHeader><CardTitle className="text-base">Transações ({transactions.length})</CardTitle></CardHeader>
              <CardContent className="p-0">
                {transactions.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">Nenhuma transação no período</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Data</TableHead>
                        <TableHead>Descrição</TableHead>
                        <TableHead>Categoria</TableHead>
                        <TableHead className="text-right">Valor</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {transactions.slice(0, 50).map((t) => (
                        <TableRow key={t.id}>
                          <TableCell className="text-sm">{format(new Date(t.created_at), "dd/MM/yyyy")}</TableCell>
                          <TableCell className="text-sm">{t.description || t.beneficiary_name || "—"}</TableCell>
                          <TableCell className="text-sm">{t.categories?.name || "—"}</TableCell>
                          <TableCell className="text-right font-mono-numbers font-medium">{formatCurrency(Number(t.amount))}</TableCell>
                          <TableCell>
                            <span className={`text-xs font-medium ${t.status === "completed" ? "text-success" : t.status === "failed" ? "text-destructive" : "text-muted-foreground"}`}>
                              {t.status === "completed" ? "Concluído" : t.status === "failed" ? "Falhou" : t.status === "cancelled" ? "Cancelado" : "Pendente"}
                            </span>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </MainLayout>
  );
}
