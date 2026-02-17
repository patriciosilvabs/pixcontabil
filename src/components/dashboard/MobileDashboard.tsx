import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { PixKeyDialog } from "@/components/pix/PixKeyDialog";
import { PixQrPaymentDrawer } from "@/components/pix/PixQrPaymentDrawer";
import { BarcodeScanner } from "@/components/payment/BarcodeScanner";
import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { QrCode, Key, ClipboardPaste, Star, CalendarClock, FileText, ArrowUpRight, Wallet, DollarSign, Inbox, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/utils";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
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
  { label: "MENU PIX", icon: Wallet, href: "/pix/new" },
  { label: "PAGAR QR CODE", icon: QrCode, href: "/pix/new?tab=qrcode" },
  { label: "COPIA E COLA", icon: ClipboardPaste, href: "/pix/new?tab=copy_paste" },
  { label: "COM CHAVE", icon: Key, href: "/pix/new?tab=key" },
  { label: "FAVORECIDOS", icon: Star, href: "/transactions?filter=favorites" },
  { label: "AGENDADAS", icon: CalendarClock, href: "/transactions?status=pending" },
  { label: "BOLETO", icon: FileText, href: "/pix/new?tab=boleto" },
  { label: "TRANSFERIR", icon: ArrowUpRight, href: "/pix/new?tab=key" },
];

const todayLabel = format(new Date(), "dd 'DE' MMMM 'DE' yyyy", { locale: ptBR }).toUpperCase();

export function MobileDashboard({ balanceVisible, onToggleBalance, balance, balanceLoading, balanceAvailable, provider, recentTransactions = [], dataLoading }: MobileDashboardProps) {
  const [pixKeyOpen, setPixKeyOpen] = useState(false);
  const [qrScannerOpen, setQrScannerOpen] = useState(false);
  const [scannedQrCode, setScannedQrCode] = useState("");
  const [qrPaymentOpen, setQrPaymentOpen] = useState(false);
  const navigate = useNavigate();

  const handleQrScan = (result: string) => {
    setQrScannerOpen(false);
    setScannedQrCode(result);
    setQrPaymentOpen(true);
  };

  return (
    <div className="px-4 pt-4 pb-24 space-y-6">
      {/* Balance Card */}
      <Card className="overflow-hidden shadow-md">
        <CardContent className="p-5">
          <span className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            Saldo Disponível
          </span>
          {balanceLoading ? (
            <Skeleton className="h-9 w-32 mt-1" />
          ) : (
            <p className="text-3xl font-bold font-mono-numbers tracking-tight mt-1">
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
          <Progress value={0} className="mt-4 h-2.5 [&>div]:bg-primary" />
        </CardContent>
      </Card>

      {/* Quick Actions Grid */}
      <div>
        <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">
          Funções Principais
        </h2>
        <div className="grid grid-cols-4 gap-3">
          {quickActions.map((action) => {
            const isPixKey = action.label === "COM CHAVE";
            const isQrCode = action.label === "PAGAR QR CODE";

            if (isPixKey || isQrCode) {
              return (
                <button
                  key={action.label}
                  onClick={() => isPixKey ? setPixKeyOpen(true) : setQrScannerOpen(true)}
                  className="flex flex-col items-center gap-2 p-4 rounded-2xl bg-secondary shadow-sm hover:bg-secondary/80 transition-colors"
                >
                  <div className="w-12 h-12 rounded-full bg-primary flex items-center justify-center">
                    <action.icon className="h-6 w-6 text-primary-foreground" />
                  </div>
                  <span className="text-[10px] font-semibold text-center leading-tight text-foreground/80">
                    {action.label}
                  </span>
                </button>
              );
            }

            return (
              <Link
                key={action.label}
                to={action.href}
                className="flex flex-col items-center gap-2 p-4 rounded-2xl bg-secondary shadow-sm hover:bg-secondary/80 transition-colors"
              >
                <div className="w-12 h-12 rounded-full bg-primary flex items-center justify-center">
                  <action.icon className="h-6 w-6 text-primary-foreground" />
                </div>
                <span className="text-[10px] font-semibold text-center leading-tight text-foreground/80">
                  {action.label}
                </span>
              </Link>
            );
          })}
        </div>
      </div>

      <PixKeyDialog open={pixKeyOpen} onOpenChange={setPixKeyOpen} />
      <BarcodeScanner
        mode="qrcode"
        isOpen={qrScannerOpen}
        onScan={handleQrScan}
        onClose={() => setQrScannerOpen(false)}
      />
      <PixQrPaymentDrawer
        open={qrPaymentOpen}
        qrCode={scannedQrCode}
        onOpenChange={setQrPaymentOpen}
      />

      {/* Recent Transactions */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-bold uppercase tracking-wide">Transações Recentes</h2>
          <Link to="/transactions" className="text-xs font-semibold text-primary uppercase">
            Extrato Completo
          </Link>
        </div>

        {/* Date separator */}
        <div className="flex items-center gap-2 mb-3">
          <div className="h-px flex-1 bg-border" />
          <span className="text-[10px] font-bold text-muted-foreground tracking-wider">{todayLabel}</span>
          <div className="h-px flex-1 bg-border" />
        </div>

        <Card>
          <CardContent className="p-4">
            {dataLoading ? (
              <div className="space-y-4">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="flex items-center gap-3">
                    <Skeleton className="h-10 w-10 rounded-full" />
                    <div className="flex-1 space-y-1.5">
                      <Skeleton className="h-3 w-20" />
                      <Skeleton className="h-3.5 w-28" />
                    </div>
                    <Skeleton className="h-4 w-16" />
                  </div>
                ))}
              </div>
            ) : recentTransactions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-6 text-muted-foreground">
                <Inbox className="h-8 w-8 mb-1.5" />
                <p className="text-sm">Nenhuma transação encontrada</p>
              </div>
            ) : (
              <div className="space-y-1">
                {recentTransactions.map((tx) => (
                  <div key={tx.id} className="flex items-center gap-3 py-3 border-b border-border last:border-0">
                    <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <DollarSign className="h-5 w-5 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                        PAGAMENTO EFETUADO
                      </p>
                      <p className="text-sm font-medium truncate">{tx.beneficiary}</p>
                      <p className="text-xs text-muted-foreground">{tx.time}</p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <div className="text-right">
                        <p className="text-sm font-bold font-mono-numbers text-destructive">
                          -{formatCurrency(tx.amount)}
                        </p>
                        <p className="text-[10px] text-muted-foreground font-mono-numbers">
                          -{formatCurrency(tx.amount)}
                        </p>
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </div>
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
