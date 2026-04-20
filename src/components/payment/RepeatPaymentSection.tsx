import { Card, CardContent } from "@/components/ui/card";
import { useRecentPayments, type RecentPayment } from "@/hooks/useRecentPayments";
import { formatCurrency } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { RefreshCw, Repeat2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

const pixKeyTypeLabels: Record<string, string> = {
  cpf: "CPF",
  cnpj: "CNPJ",
  email: "E-mail",
  phone: "Telefone",
  random: "Chave",
};

function getInitials(name: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return (parts[0]?.[0] || "?").toUpperCase();
}

function maskKey(key: string): string {
  if (key.length <= 6) return key;
  return key.slice(0, 3) + "***" + key.slice(-4);
}

interface RepeatPaymentSectionProps {
  onSelect: (payment: RecentPayment) => void;
}

export function RepeatPaymentSection({ onSelect }: RepeatPaymentSectionProps) {
  const { payments, isLoading } = useRecentPayments({ limit: 5 });

  if (isLoading) {
    return (
      <div>
        <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-2">
          <Repeat2 className="h-3.5 w-3.5" /> Repetir Pagamento
        </h2>
        <Card>
          <CardContent className="p-3 space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-10 w-10 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-3 w-32" />
                </div>
                <Skeleton className="h-4 w-16" />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (payments.length === 0) return null;

  return (
    <div>
      <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-2">
        <Repeat2 className="h-3.5 w-3.5" /> Repetir Pagamento
      </h2>
      <Card>
        <CardContent className="p-2">
          {payments.map((payment, idx) => {
            const label = payment.beneficiary_name || maskKey(payment.pix_key);
            const subType = payment.pix_key_type
              ? pixKeyTypeLabels[payment.pix_key_type]
              : payment.pix_type === "qrcode"
                ? "QR Code"
                : payment.pix_type === "copy_paste"
                  ? "Copia e Cola"
                  : "Pix";
            const when = formatDistanceToNow(new Date(payment.created_at), { addSuffix: true, locale: ptBR });
            return (
              <button
                key={`${payment.pix_key}-${idx}`}
                type="button"
                onClick={() => onSelect(payment)}
                className="w-full flex items-center gap-3 p-2.5 rounded-lg hover:bg-accent/50 active:bg-accent transition-colors text-left"
              >
                <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <span className="text-sm font-bold text-primary">{getInitials(payment.beneficiary_name)}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{label}</p>
                  <p className="text-[11px] text-muted-foreground truncate">
                    {subType} · {when}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <p className="text-sm font-bold font-mono-numbers text-primary">
                    {formatCurrency(payment.amount)}
                  </p>
                  <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                    <RefreshCw className="h-3.5 w-3.5 text-primary" />
                  </div>
                </div>
              </button>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
