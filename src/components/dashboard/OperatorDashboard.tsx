import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils";
import { Link } from "react-router-dom";
import {
  Send,
  History,
  FileWarning,
  ArrowRight,
  DollarSign,
  Clock,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";

// Mock data - will be replaced with real data from Supabase
const mockOperatorData = {
  transactionsToday: 5,
  pendingReceipts: 2,
  recentTransactions: [
    {
      id: "1",
      beneficiary: "Moinho Santa Clara",
      amount: 2450.00,
      time: "10 min atrás",
      status: "completed",
      hasReceipt: true,
    },
    {
      id: "2",
      beneficiary: "CEMIG",
      amount: 1230.50,
      time: "1h atrás",
      status: "completed",
      hasReceipt: false,
    },
    {
      id: "3",
      beneficiary: "Atacadão",
      amount: 3890.00,
      time: "2h atrás",
      status: "completed",
      hasReceipt: true,
    },
  ],
};

export function OperatorDashboard() {
  const { profile, currentCompany } = useAuth();

  return (
    <div className="p-6 lg:p-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold">
            Olá, {profile?.full_name?.split(" ")[0]}! 👋
          </h1>
          <p className="text-muted-foreground">
            {currentCompany?.name} • Operador
          </p>
        </div>

        {/* Quick actions */}
        <div className="grid grid-cols-2 gap-4">
          <Button
            asChild
            size="lg"
            className="h-auto py-6 flex-col gap-2 bg-gradient-primary hover:opacity-90 shadow-primary"
          >
            <Link to="/pix/new">
              <Send className="h-8 w-8" />
              <span className="font-semibold">Novo Pix</span>
            </Link>
          </Button>
          <Button
            asChild
            size="lg"
            variant="outline"
            className="h-auto py-6 flex-col gap-2"
          >
            <Link to="/transactions">
              <History className="h-8 w-8" />
              <span className="font-semibold">Histórico</span>
            </Link>
          </Button>
        </div>
      </div>

      {/* Balance hidden card */}
      <Card className="bg-muted/50">
        <CardContent className="p-6 text-center">
          <p className="text-sm text-muted-foreground mb-2">Saldo da conta</p>
          <p className="text-4xl font-bold text-muted-foreground">---</p>
          <p className="text-xs text-muted-foreground mt-2">
            Saldo oculto para operadores
          </p>
        </CardContent>
      </Card>

      {/* Alert for pending receipts */}
      {mockOperatorData.pendingReceipts > 0 && (
        <Card className="border-warning/50 bg-warning/5">
          <CardContent className="flex items-center gap-4 p-4">
            <div className="h-10 w-10 rounded-full bg-warning/20 flex items-center justify-center">
              <FileWarning className="h-5 w-5 text-warning" />
            </div>
            <div className="flex-1">
              <p className="font-medium">
                {mockOperatorData.pendingReceipts} comprovantes pendentes
              </p>
              <p className="text-sm text-muted-foreground">
                Anexe os comprovantes para completar os pagamentos
              </p>
            </div>
            <Button variant="outline" size="sm" asChild>
              <Link to="/transactions?status=pending">
                Anexar
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-primary-light flex items-center justify-center">
                <Clock className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">
                  {mockOperatorData.transactionsToday}
                </p>
                <p className="text-sm text-muted-foreground">Pagamentos hoje</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-warning/10 flex items-center justify-center">
                <FileWarning className="h-5 w-5 text-warning" />
              </div>
              <div>
                <p className="text-2xl font-bold">
                  {mockOperatorData.pendingReceipts}
                </p>
                <p className="text-sm text-muted-foreground">Pendentes</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* My recent transactions */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-4">
          <div>
            <CardTitle className="text-lg">Meus Pagamentos</CardTitle>
            <CardDescription>Transações realizadas hoje</CardDescription>
          </div>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/transactions">
              Ver todos
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {mockOperatorData.recentTransactions.map((transaction) => (
            <div
              key={transaction.id}
              className="flex items-center justify-between p-3 rounded-lg bg-muted/50"
            >
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                  <DollarSign className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="font-medium text-sm">{transaction.beneficiary}</p>
                  <p className="text-xs text-muted-foreground">{transaction.time}</p>
                </div>
              </div>
              <div className="text-right">
                <p className="font-bold font-mono-numbers text-sm">
                  {formatCurrency(transaction.amount)}
                </p>
                <div className="flex items-center justify-end gap-1 mt-1">
                  {transaction.hasReceipt ? (
                    <span className="text-xs text-success flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3" />
                      Comprovante OK
                    </span>
                  ) : (
                    <span className="text-xs text-warning flex items-center gap-1">
                      <AlertCircle className="h-3 w-3" />
                      Sem comprovante
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}

          {mockOperatorData.recentTransactions.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              <History className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>Nenhum pagamento realizado hoje</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
