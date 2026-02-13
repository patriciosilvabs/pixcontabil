import { useMemo, useState, useEffect } from "react";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { ImageOff, Eye } from "lucide-react";
import { batchSignedUrls } from "@/utils/storageHelpers";

interface Transaction {
  id: string;
  created_at: string;
  description?: string | null;
  beneficiary_name?: string | null;
  amount: number;
  status: string;
  categories?: { name: string; classification: string } | null;
  receipts?: { file_url: string; file_name?: string | null }[] | null;
}

interface DayGroup {
  dateKey: string;
  label: string;
  subtotal: number;
  transactions: Transaction[];
}

interface Props {
  transactions: Transaction[];
}

const formatCurrency = (v: number) =>
  `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;

const statusMap: Record<string, { label: string; className: string }> = {
  completed: { label: "Concluído", className: "text-success" },
  failed: { label: "Falhou", className: "text-destructive" },
  cancelled: { label: "Cancelado", className: "text-muted-foreground" },
  pending: { label: "Pendente", className: "text-muted-foreground" },
};

export function DailyTransactionSummary({ transactions }: Props) {
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // Group transactions by day
  const dayGroups = useMemo<DayGroup[]>(() => {
    const map: Record<string, Transaction[]> = {};
    transactions.forEach((t) => {
      const key = format(new Date(t.created_at), "yyyy-MM-dd");
      if (!map[key]) map[key] = [];
      map[key].push(t);
    });
    return Object.entries(map)
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([dateKey, txs]) => ({
        dateKey,
        label: format(parseISO(dateKey), "EEEE, dd/MM/yyyy", { locale: ptBR }),
        subtotal: txs.reduce((s, t) => s + Number(t.amount), 0),
        transactions: txs,
      }));
  }, [transactions]);

  // Fetch signed URLs for all receipts
  useEffect(() => {
    const urls = transactions
      .map((t) => t.receipts?.[0]?.file_url)
      .filter(Boolean) as string[];
    if (urls.length === 0) return;
    batchSignedUrls(urls).then(setSignedUrls);
  }, [transactions]);

  if (dayGroups.length === 0) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-base">Resumo por Dia</CardTitle></CardHeader>
        <CardContent>
          <p className="text-center text-muted-foreground py-8">Nenhuma transação no período</p>
        </CardContent>
      </Card>
    );
  }

  const defaultOpen = dayGroups.length === 1 ? [dayGroups[0].dateKey] : [dayGroups[0].dateKey];

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Resumo por Dia ({transactions.length} transações)</CardTitle></CardHeader>
      <CardContent className="p-2 sm:p-6">
        <Dialog open={!!previewUrl} onOpenChange={(open) => !open && setPreviewUrl(null)}>
          <Accordion type="multiple" defaultValue={defaultOpen} className="space-y-2">
            {dayGroups.map((day) => (
              <AccordionItem key={day.dateKey} value={day.dateKey} className="border rounded-lg px-3">
                <AccordionTrigger className="hover:no-underline">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 text-left">
                    <span className="font-semibold capitalize">{day.label}</span>
                    <span className="text-sm text-muted-foreground">
                      Subtotal: <span className="font-mono-numbers font-medium text-foreground">{formatCurrency(day.subtotal)}</span>
                    </span>
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="space-y-2">
                    {day.transactions.map((t) => {
                      const receiptFileUrl = t.receipts?.[0]?.file_url || "";
                      const signed = receiptFileUrl ? signedUrls[receiptFileUrl] : "";
                      const st = statusMap[t.status] || statusMap.pending;

                      return (
                        <div
                          key={t.id}
                          className="flex items-center gap-3 p-2 rounded-md hover:bg-muted/50 transition-colors"
                        >
                          {/* Thumbnail */}
                          {signed ? (
                            <DialogTrigger asChild>
                              <button
                                onClick={() => setPreviewUrl(signed)}
                                className="relative shrink-0 w-14 h-14 rounded-md overflow-hidden border bg-muted cursor-pointer group"
                              >
                                <img
                                  src={signed}
                                  alt="Comprovante"
                                  className="w-full h-full object-cover"
                                />
                                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                  <Eye className="h-4 w-4 text-white" />
                                </div>
                              </button>
                            </DialogTrigger>
                          ) : (
                            <div className="shrink-0 w-14 h-14 rounded-md border bg-muted flex items-center justify-center">
                              <ImageOff className="h-5 w-5 text-muted-foreground" />
                            </div>
                          )}

                          {/* Info */}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">
                              {t.description || t.beneficiary_name || "Sem descrição"}
                            </p>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              {t.categories?.name && <span>{t.categories.name}</span>}
                              {t.categories?.classification && (
                                <span className="px-1.5 py-0.5 rounded bg-muted text-xs">
                                  {t.categories.classification === "cost" ? "Custo" : "Despesa"}
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Amount + Status */}
                          <div className="text-right shrink-0">
                            <p className="text-sm font-mono-numbers font-medium">{formatCurrency(Number(t.amount))}</p>
                            <span className={`text-xs font-medium ${st.className}`}>{st.label}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>

          {/* Full-size receipt dialog */}
          <DialogContent className="max-w-3xl max-h-[90vh] p-2">
            {previewUrl && (
              <img
                src={previewUrl}
                alt="Comprovante ampliado"
                className="w-full h-auto max-h-[85vh] object-contain rounded"
              />
            )}
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
