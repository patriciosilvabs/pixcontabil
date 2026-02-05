import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatCurrency, formatDateTime } from "@/lib/utils";
import { useState } from "react";
import {
  Search,
  Filter,
  Download,
  DollarSign,
  ArrowUpRight,
  ArrowDownRight,
  CheckCircle2,
  AlertCircle,
  Clock,
  FileText,
  Eye,
} from "lucide-react";

// Mock data
const mockTransactions = [
  {
    id: "1",
    beneficiary: "Moinho Santa Clara",
    amount: 2450.0,
    classification: "cost",
    category: "Insumos",
    status: "completed",
    hasReceipt: true,
    createdAt: "2024-01-15T10:30:00Z",
    createdBy: "João Silva",
  },
  {
    id: "2",
    beneficiary: "CEMIG",
    amount: 1230.5,
    classification: "expense",
    category: "Utilidades",
    status: "completed",
    hasReceipt: true,
    createdAt: "2024-01-15T09:15:00Z",
    createdBy: "Maria Santos",
  },
  {
    id: "3",
    beneficiary: "Atacadão",
    amount: 3890.0,
    classification: "cost",
    category: "Insumos",
    status: "pending",
    hasReceipt: false,
    createdAt: "2024-01-15T08:00:00Z",
    createdBy: "João Silva",
  },
  {
    id: "4",
    beneficiary: "Aluguel Loja Centro",
    amount: 5500.0,
    classification: "expense",
    category: "Ocupação",
    status: "completed",
    hasReceipt: true,
    createdAt: "2024-01-14T16:00:00Z",
    createdBy: "Admin",
  },
  {
    id: "5",
    beneficiary: "Google Ads",
    amount: 850.0,
    classification: "expense",
    category: "Marketing",
    status: "completed",
    hasReceipt: true,
    createdAt: "2024-01-14T14:30:00Z",
    createdBy: "Maria Santos",
  },
];

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
    icon: AlertCircle,
    className: "bg-destructive/10 text-destructive",
  },
};

export default function Transactions() {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [classificationFilter, setClassificationFilter] = useState<string>("all");

  const filteredTransactions = mockTransactions.filter((t) => {
    const matchesSearch = t.beneficiary
      .toLowerCase()
      .includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === "all" || t.status === statusFilter;
    const matchesClassification =
      classificationFilter === "all" || t.classification === classificationFilter;
    return matchesSearch && matchesStatus && matchesClassification;
  });

  return (
    <MainLayout>
      <div className="p-6 lg:p-8 space-y-6">
        {/* Header */}
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <h1 className="text-2xl lg:text-3xl font-bold">Histórico de Transações</h1>
            <p className="text-muted-foreground">
              Visualize e gerencie todos os pagamentos
            </p>
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
              {/* Search */}
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar por favorecido..."
                  className="pl-10"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>

              {/* Status filter */}
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full sm:w-40">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="completed">Concluídos</SelectItem>
                  <SelectItem value="pending">Pendentes</SelectItem>
                  <SelectItem value="failed">Falhos</SelectItem>
                </SelectContent>
              </Select>

              {/* Classification filter */}
              <Select
                value={classificationFilter}
                onValueChange={setClassificationFilter}
              >
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

        {/* Transactions list */}
        <div className="space-y-4">
          {filteredTransactions.map((transaction) => {
            const status = statusConfig[transaction.status as keyof typeof statusConfig];
            const StatusIcon = status.icon;

            return (
              <Card
                key={transaction.id}
                className="hover:shadow-md transition-shadow cursor-pointer"
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    {/* Left side */}
                    <div className="flex items-start gap-4">
                      <div
                        className={`h-12 w-12 rounded-xl flex items-center justify-center ${
                          transaction.classification === "cost"
                            ? "bg-primary/10"
                            : "bg-destructive/10"
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
                            {transaction.classification === "cost"
                              ? "Custo"
                              : "Despesa"}
                          </Badge>
                          <span>•</span>
                          <span>{transaction.category}</span>
                          <span className="hidden sm:inline">•</span>
                          <span className="hidden sm:inline">
                            {formatDateTime(transaction.createdAt)}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground sm:hidden">
                          {formatDateTime(transaction.createdAt)}
                        </p>
                      </div>
                    </div>

                    {/* Right side */}
                    <div className="text-right space-y-2">
                      <p className="text-lg font-bold font-mono-numbers">
                        {formatCurrency(transaction.amount)}
                      </p>
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
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-warning border-warning/30"
                          >
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
                <p className="text-muted-foreground">
                  Nenhuma transação encontrada
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </MainLayout>
  );
}
