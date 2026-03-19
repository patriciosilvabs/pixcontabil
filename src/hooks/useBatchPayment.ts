import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

export interface BatchPaymentItem {
  type: "pix_key" | "boleto";
  pix_key?: string;
  pix_key_type?: string;
  codigo_barras?: string;
  valor: number;
  descricao?: string;
}

export interface BatchResult {
  index: number;
  success: boolean;
  transaction_id?: string;
  error?: string;
}

export interface BatchSummary {
  total: number;
  success_count: number;
  failed_count: number;
}

export function useBatchPayment() {
  const { currentCompany, session } = useAuth();
  const { toast } = useToast();
  const [isProcessing, setIsProcessing] = useState(false);
  const [results, setResults] = useState<BatchResult[] | null>(null);
  const [summary, setSummary] = useState<BatchSummary | null>(null);

  const executeBatch = useCallback(async (items: BatchPaymentItem[]): Promise<boolean> => {
    if (!currentCompany || !session) {
      toast({ variant: "destructive", title: "Erro", description: "Você precisa estar logado." });
      return false;
    }

    if (items.length === 0) {
      toast({ variant: "destructive", title: "Erro", description: "Adicione pelo menos um pagamento." });
      return false;
    }

    if (items.length > 50) {
      toast({ variant: "destructive", title: "Erro", description: "Máximo de 50 itens por lote." });
      return false;
    }

    setIsProcessing(true);
    setResults(null);
    setSummary(null);

    try {
      const { data, error } = await supabase.functions.invoke("batch-pay", {
        body: { company_id: currentCompany.id, items },
      });

      if (error) {
        console.error("[useBatchPayment] error:", error);
        let errorMessage = "Falha ao processar lote.";
        try {
          if (error.context && typeof error.context === "object") {
            const res = error.context as Response;
            if (res?.json) {
              const body = await res.json();
              errorMessage = body?.error || errorMessage;
            }
          }
        } catch { /* ignore */ }
        toast({ variant: "destructive", title: "Erro no lote", description: errorMessage });
        return false;
      }

      setResults(data.results);
      setSummary(data.summary);

      if (data.summary.failed_count === 0) {
        toast({ title: "Lote concluído!", description: `Todos os ${data.summary.total} pagamentos foram processados com sucesso.` });
      } else {
        toast({
          variant: "destructive",
          title: "Lote concluído com falhas",
          description: `${data.summary.success_count} de ${data.summary.total} pagamentos foram bem-sucedidos.`,
        });
      }

      return true;
    } catch (err: any) {
      console.error("[useBatchPayment] exception:", err);
      toast({ variant: "destructive", title: "Erro", description: "Falha na comunicação com o servidor." });
      return false;
    } finally {
      setIsProcessing(false);
    }
  }, [currentCompany, session, toast]);

  const reset = useCallback(() => {
    setResults(null);
    setSummary(null);
  }, []);

  return { isProcessing, results, summary, executeBatch, reset };
}
