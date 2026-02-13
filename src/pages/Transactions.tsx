import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatCurrency, formatDateTime } from "@/lib/utils";
import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import {
  Search,
  Download,
  DollarSign,
  ArrowUpRight,
  ArrowDownRight,
  CheckCircle2,
  AlertCircle,
  FileText,
  Eye,
  Loader2,
  XCircle,
} from "lucide-react";

interface TransactionRow {
  id: string;
  beneficiary: string;
  amount: number;
  classification: string;
  category: string;
  status: string;
  hasReceipt: boolean;
  createdAt: string;
}

const statusConfig = {
  completed: {
    label: "Concluído",
    icon: CheckCircle2,
    className: "bg-success/10 text-success",
  },
  pending: {
    label: "Pendente",
    icon: AlertCircle,
    className: "bg-warning/10 text-warning",
  },
  failed: {
    label: "Falhou",
    icon: XCircle,
    className: "bg-destructive/10 text-destructive",
  },
  cancelled: {
    label: "Cancelado",
    icon: XCircle,
    className: "bg-muted text-muted-foreground",
  },
};

export default function Transactions() {
  const [searchParams] = useSearchParams();
  const { currentCompany } = useAuth();
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>(searchParams.get("status") || "all");
  const [classificationFilter, setClassificationFilter] = useState<string>("all");
  const [transactions, setTransactions] = useState<TransactionRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!currentCompany) return;

    const fetchTransactions = async () => {
      setIsLoading(true);
      const { data, error } = await supabase
        .from("transactions")
        .select("*, categories(name, classification), receipts(id)")
        .eq("company_id", currentCompany.id)
        .order("created_at", { ascending: false })
        .limit(100);

      if (error) {
        console.error("Error fetching transactions:", error);
        setTransactions([]);
      } else {
        const mapped: TransactionRow[] = (data || []).map((t: any) => ({
          id: t.id,
          beneficiary: t.beneficiary_name || t.description || "Sem nome",
          amount: Number(t.amount),
          classification: t.categories?.classification || "expense",
          category: t.categories?.name || "Sem categoria",
          status: t.status,
          hasReceipt: Array.isArray(t.receipts) && t.receipts.length > 0,
          createdAt: t.created_at,
        }));
        setTransactions(mapped);
      }
      setIsLoading(false);
    };

    fetchTransactions();
  }, [currentCompany]);

  const filteredTransactions = transactions.filter((t) => {
    const matchesSearch = t.beneficiary.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === "all" || t.status === statusFilter;
    const matchesClassification = classificationFilter === "all" || t.classification === classificationFilter;
    return matchesSearch && matchesStatus && matchesClassification;
  });

  return (
    <MainLayout>
      <div className="p-6 lg:p-8 space-y-6">
        {/* Header */}
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <h1 className="text-2xl lg:text-3xl font-bold">Histórico de Transações</h1>
            <p className="text-muted-foreground">Visualize e gerencie todos os pagamentos</p>
          </div>
          <Button variant="outline">
            <Download className="mr-2 h-4 w-4" />
            Exportar
          </Button>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="p-4">
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar por favorecido..."
                  className="pl-10"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full sm:w-40">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="completed">Concluídos</SelectItem>
                  <SelectItem value="pending">Pendentes</SelectItem>
                  <SelectItem value="failed">Falhos</SelectItem>
                  <SelectItem value="cancelled">Cancelados</SelectItem>
                </SelectContent>
              </Select>
              <Select value={classificationFilter} onValueChange={setClassificationFilter}>
                <SelectTrigger className="w-full sm:w-40">
                  <SelectValue placeholder="Classificação" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="cost">Custos</SelectItem>
                  <SelectItem value="expense">Despesas</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Loading */}
        {isLoading && (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* Transactions list */}
        {!isLoading && (
          <div className="space-y-4">
            {filteredTransactions.map((transaction) => {
              const status = statusConfig[transaction.status as keyof typeof statusConfig] || statusConfig.pending;
              const StatusIcon = status.icon;

              return (
                <Card key={transaction.id} className="hover:shadow-md transition-shadow cursor-pointer">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-4">
                        <div
                          className={`h-12 w-12 rounded-xl flex items-center justify-center ${
                            transaction.classification === "cost" ? "bg-primary/10" : "bg-destructive/10"
                          }`}
                        >
                          {transaction.classification === "cost" ? (
                            <ArrowDownRight className="h-6 w-6 text-primary" />
                          ) : (
                            <ArrowUpRight className="h-6 w-6 text-destructive" />
                          )}
                        </div>
                        <div className="space-y-1">
                          <p className="font-semibold">{transaction.beneficiary}</p>
                          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                            <Badge
                              variant="outline"
                              className={
                                transaction.classification === "cost"
                                  ? "border-primary/30 text-primary"
                                  : "border-destructive/30 text-destructive"
                              }
                            >
                              {transaction.classification === "cost" ? "Custo" : "Despesa"}
                            </Badge>
                            <span>•</span>
                            <span>{transaction.category}</span>
                            <span className="hidden sm:inline">•</span>
                            <span className="hidden sm:inline">{formatDateTime(transaction.createdAt)}</span>
                          </div>
                          <p className="text-xs text-muted-foreground sm:hidden">
                            {formatDateTime(transaction.createdAt)}
                          </p>
                        </div>
                      </div>
                      <div className="text-right space-y-2">
                        <p className="text-lg font-bold font-mono-numbers">{formatCurrency(transaction.amount)}</p>
                        <div className="flex items-center justify-end gap-2">
                          <Badge className={status.className}>
                            <StatusIcon className="h-3 w-3 mr-1" />
                            {status.label}
                          </Badge>
                          {transaction.hasReceipt ? (
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <Eye className="h-4 w-4" />
                            </Button>
                          ) : (
                            <Button variant="outline" size="sm" className="text-warning border-warning/30">
                              <FileText className="h-3 w-3 mr-1" />
                              Anexar
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}

            {filteredTransactions.length === 0 && (
              <Card>
                <CardContent className="p-12 text-center">
                  <DollarSign className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
                  <p className="text-muted-foreground">Nenhuma transação encontrada</p>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </div>
    </MainLayout>
  );
}
