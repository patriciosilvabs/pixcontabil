import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { startOfMonth, startOfDay, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

interface TransactionWithCategory {
  id: string;
  amount: number;
  status: string;
  beneficiary_name: string | null;
  category_id: string | null;
  created_at: string;
  category_name: string | null;
  classification: string | null;
}

export interface RecentTransaction {
  id: string;
  beneficiary: string;
  amount: number;
  category: string;
  classification: string | null;
  time: string;
  status: string;
}

export interface CategoryChartData {
  name: string;
  value: number;
  color: string;
}

export interface DashboardSummary {
  totalCosts: number;
  totalExpenses: number;
  totalToday: number;
  transactionsToday: number;
  transactionsMonth: number;
  pendingReceipts: number;
}

const CHART_COLORS = [
  "hsl(270 91% 55%)",
  "hsl(158 64% 52%)",
  "hsl(43 96% 56%)",
  "hsl(200 80% 50%)",
  "hsl(0 84% 60%)",
  "hsl(320 70% 50%)",
  "hsl(100 60% 45%)",
  "hsl(30 90% 55%)",
];

export function useDashboardData() {
  const { currentCompany, isAdmin, user } = useAuth();
  const [summary, setSummary] = useState<DashboardSummary>({
    totalCosts: 0,
    totalExpenses: 0,
    totalToday: 0,
    transactionsToday: 0,
    transactionsMonth: 0,
    pendingReceipts: 0,
  });
  const [categoryData, setCategoryData] = useState<CategoryChartData[]>([]);
  const [recentTransactions, setRecentTransactions] = useState<RecentTransaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!currentCompany?.id) {
      setIsLoading(false);
      return;
    }

    const fetchData = async () => {
      setIsLoading(true);
      const now = new Date();
      const monthStart = startOfMonth(now).toISOString();
      const dayStart = startOfDay(now).toISOString();

      try {
        // Fetch month transactions with category info
        let query = supabase
          .from("transactions")
          .select("id, amount, status, beneficiary_name, category_id, created_at, categories(name, classification)")
          .eq("company_id", currentCompany.id)
          .gte("created_at", monthStart)
          .order("created_at", { ascending: false });

        if (!isAdmin && user) {
          query = query.eq("created_by", user.id);
        }

        const { data: monthTxs } = await query;

        const transactions: TransactionWithCategory[] = (monthTxs || []).map((t: any) => ({
          id: t.id,
          amount: t.amount,
          status: t.status,
          beneficiary_name: t.beneficiary_name,
          category_id: t.category_id,
          created_at: t.created_at,
          category_name: t.categories?.name ?? null,
          classification: t.categories?.classification ?? null,
        }));

        // Calculate summary
        let totalCosts = 0;
        let totalExpenses = 0;
        let totalToday = 0;
        let transactionsToday = 0;
        let pendingReceipts = 0;

        for (const tx of transactions) {
          if (tx.classification === "cost") totalCosts += Number(tx.amount);
          if (tx.classification === "expense") totalExpenses += Number(tx.amount);
          if (tx.created_at >= dayStart) {
            totalToday += Number(tx.amount);
            transactionsToday++;
          }
          if (!tx.category_id) pendingReceipts++;
        }

        setSummary({
          totalCosts,
          totalExpenses,
          totalToday,
          transactionsToday,
          transactionsMonth: transactions.length,
          pendingReceipts,
        });

        // Category chart data
        const catMap = new Map<string, number>();
        for (const tx of transactions) {
          const name = tx.category_name || "Sem categoria";
          catMap.set(name, (catMap.get(name) || 0) + Number(tx.amount));
        }
        const chartData: CategoryChartData[] = Array.from(catMap.entries())
          .sort((a, b) => b[1] - a[1])
          .map(([name, value], i) => ({
            name,
            value,
            color: CHART_COLORS[i % CHART_COLORS.length],
          }));
        setCategoryData(chartData);

        // Recent transactions (top 5)
        const recent: RecentTransaction[] = transactions.slice(0, 5).map((tx) => ({
          id: tx.id,
          beneficiary: tx.beneficiary_name || "Sem beneficiário",
          amount: Number(tx.amount),
          category: tx.category_name || "Sem categoria",
          classification: tx.classification,
          time: formatDistanceToNow(new Date(tx.created_at), { addSuffix: true, locale: ptBR }),
          status: tx.status,
        }));
        setRecentTransactions(recent);
      } catch (error) {
        console.error("Error fetching dashboard data:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [currentCompany?.id, isAdmin, user?.id]);

  return { summary, categoryData, recentTransactions, isLoading };
}
