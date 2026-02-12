import React from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Eye, EyeOff, QrCode, Key, ClipboardPaste, Star, CalendarClock, FileText, ArrowUpRight, Wallet, DollarSign, Inbox } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/utils";
import type { RecentTransaction } from "@/hooks/useDashboardData";

interface MobileDashboardProps {
  balanceVisible: boolean;
  onToggleBalance: () => void;
  balance?: number | null;
  balanceLoading?: boolean;
  balanceAvailable?: boolean;
  provider?: string | null;
  recentTransactions?: RecentTransaction[];
  dataLoading?: boolean;
}

const quickActions = [
  { label: "MENU PIX", icon: Wallet, href: "/pix/new?tab=key", color: "text-primary" },
  { label: "PAGAR QR CODE", icon: QrCode, href: "/pix/new?tab=qrcode", color: "text-primary" },
  { label: "COPIA E COLA", icon: ClipboardPaste, href: "/pix/new?tab=copy_paste", color: "text-primary" },
  { label: "COM CHAVE", icon: Key, href: "/pix/new?tab=key", color: "text-primary" },
  { label: "FAVORECIDOS", icon: Star, href: "/transactions", color: "text-primary" },
  { label: "AGENDADAS", icon: CalendarClock, href: "/transactions", color: "text-primary" },
  { label: "BOLETO", icon: FileText, href: "/pix/new?tab=boleto", color: "text-primary" },
  { label: "TRANSFERIR", icon: ArrowUpRight, href: "/pix/new", color: "text-primary" },
];

export function MobileDashboard({ balanceVisible, onToggleBalance, balance, balanceLoading, balanceAvailable, provider, recentTransactions = [], dataLoading }: MobileDashboardProps) {
  return (
    <div className="px-4 pb-24 space-y-6">
      {/* Balance Card */}
      <Card className="overflow-hidden shadow-md">
        <CardContent className="p-5">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
              Saldo Disponível
            </span>
            <button onClick={onToggleBalance} className="text-muted-foreground hover:text-foreground transition-colors">
              {balanceVisible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
            </button>
          </div>
          {balanceLoading ? (
            <Skeleton className="h-9 w-32" />
          ) : (
            <p className="text-3xl font-bold font-mono-numbers tracking-tight">
              {balanceVisible
                ? balanceAvailable
                  ? formatCurrency(balance ?? 0)
                  : "Indisponível"
                : "••••••"}
            </p>
          )}
          {provider && (
            <p className="text-xs text-muted-foreground mt-1">Provedor: {provider}</p>
          )}
          <Progress value={0} className="mt-4 h-1.5 [&>div]:bg-gradient-bank-header" />
        </CardContent>
      </Card>

      {/* Quick Actions Grid */}
      <div className="grid grid-cols-4 gap-3">
        {quickActions.map((action) => (
          <Link
            key={action.label}
            to={action.href}
            className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-secondary hover:bg-secondary/80 transition-colors"
          >
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
              <action.icon className={cn("h-5 w-5", action.color)} />
            </div>
            <span className="text-[10px] font-semibold text-center leading-tight text-foreground/80">
              {action.label}
            </span>
          </Link>
        ))}
      </div>

      {/* Recent Transactions */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold uppercase tracking-wide">Transações Recentes</h2>
          <Link to="/transactions" className="text-xs font-semibold text-primary uppercase">
            Extrato Completo
          </Link>
        </div>
        <Card>
          <CardContent className="p-4">
            {dataLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="flex items-center gap-3">
                    <Skeleton className="h-9 w-9 rounded-full" />
                    <div className="flex-1 space-y-1.5">
                      <Skeleton className="h-3.5 w-28" />
                      <Skeleton className="h-3 w-20" />
                    </div>
                    <Skeleton className="h-4 w-16" />
                  </div>
                ))}
              </div>
            ) : recentTransactions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-4 text-muted-foreground">
                <Inbox className="h-8 w-8 mb-1.5" />
                <p className="text-sm">Nenhuma transação encontrada</p>
              </div>
            ) : (
              <div className="space-y-3">
                {recentTransactions.map((tx) => (
                  <div key={tx.id} className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <DollarSign className="h-4 w-4 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{tx.beneficiary}</p>
                      <p className="text-xs text-muted-foreground">{tx.time}</p>
                    </div>
                    <p className="text-sm font-bold font-mono-numbers text-destructive shrink-0">
                      -{formatCurrency(tx.amount)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
