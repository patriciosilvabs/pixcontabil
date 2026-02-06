import { useState, useCallback, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

interface CreateCobParams {
  valor: number;
  descricao?: string;
  devedor?: {
    cpf?: string;
    cnpj?: string;
    nome: string;
  };
  expiracao?: number;
}

interface CobResult {
  success: boolean;
  transaction_id: string;
  txid: string;
  location?: string;
  pix_copia_cola?: string;
  status: string;
  expiration: string;
}

interface PaymentStatus {
  txid: string;
  status: string;
  paid: boolean;
  paid_at?: string;
  e2eid?: string;
  valor?: string;
}

export function usePixPayment() {
  const { currentCompany, session } = useAuth();
  const { toast } = useToast();
  const [isCreating, setIsCreating] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [cobData, setCobData] = useState<CobResult | null>(null);
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus | null>(null);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  // Create a new Pix charge (Cob)
  const createCob = useCallback(async (params: CreateCobParams): Promise<CobResult | null> => {
    if (!currentCompany || !session) {
      toast({
        variant: "destructive",
        title: "Erro",
        description: "Você precisa estar logado e ter uma empresa selecionada.",
      });
      return null;
    }

    setIsCreating(true);

    try {
      const { data, error } = await supabase.functions.invoke('pix-create-cob', {
        body: {
          company_id: currentCompany.id,
          ...params,
        },
      });

      if (error) {
        console.error('[usePixPayment] Create cob error:', error);
        toast({
          variant: "destructive",
          title: "Erro ao criar cobrança Pix",
          description: error.message || "Tente novamente mais tarde.",
        });
        return null;
      }

      if (!data.success) {
        toast({
          variant: "destructive",
          title: "Erro ao criar cobrança",
          description: data.error || "Erro desconhecido.",
        });
        return null;
      }

      setCobData(data);
      return data;

    } catch (error) {
      console.error('[usePixPayment] Create cob exception:', error);
      toast({
        variant: "destructive",
        title: "Erro",
        description: "Falha na comunicação com o servidor.",
      });
      return null;
    } finally {
      setIsCreating(false);
    }
  }, [currentCompany, session, toast]);

  // Check payment status
  const checkStatus = useCallback(async (txidOrTransactionId: string, isTransactionId = false): Promise<PaymentStatus | null> => {
    if (!session) return null;

    setIsChecking(true);

    try {
      const queryParam = isTransactionId 
        ? `transaction_id=${txidOrTransactionId}`
        : `txid=${txidOrTransactionId}`;

      const { data, error } = await supabase.functions.invoke('pix-check-status', {
        body: {},
        method: 'GET',
      });

      // Since invoke doesn't support query params well, we'll use fetch
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/pix-check-status?${queryParam}`,
        {
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        console.error('[usePixPayment] Check status error:', errorData);
        return null;
      }

      const statusData: PaymentStatus = await response.json();
      setPaymentStatus(statusData);
      return statusData;

    } catch (error) {
      console.error('[usePixPayment] Check status exception:', error);
      return null;
    } finally {
      setIsChecking(false);
    }
  }, [session]);

  // Start polling for payment status
  const startPolling = useCallback((txid: string, intervalMs = 5000, maxAttempts = 60) => {
    let attempts = 0;

    const poll = async () => {
      attempts++;
      console.log(`[usePixPayment] Polling attempt ${attempts}/${maxAttempts}`);

      const status = await checkStatus(txid);

      if (status?.paid) {
        console.log('[usePixPayment] Payment confirmed!');
        stopPolling();
        toast({
          title: "Pagamento confirmado!",
          description: "O Pix foi recebido com sucesso.",
        });
        return;
      }

      if (attempts >= maxAttempts) {
        console.log('[usePixPayment] Max polling attempts reached');
        stopPolling();
        return;
      }
    };

    // Initial check
    poll();

    // Start interval
    pollingRef.current = setInterval(poll, intervalMs);
  }, [checkStatus, toast]);

  // Stop polling
  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  // Request refund
  const requestRefund = useCallback(async (transactionId: string, valor?: number, motivo?: string) => {
    if (!session) {
      toast({
        variant: "destructive",
        title: "Erro",
        description: "Você precisa estar logado.",
      });
      return null;
    }

    try {
      const { data, error } = await supabase.functions.invoke('pix-refund', {
        body: {
          transaction_id: transactionId,
          valor,
          motivo,
        },
      });

      if (error) {
        console.error('[usePixPayment] Refund error:', error);
        toast({
          variant: "destructive",
          title: "Erro ao solicitar devolução",
          description: error.message || "Tente novamente mais tarde.",
        });
        return null;
      }

      if (data.success) {
        toast({
          title: "Devolução solicitada",
          description: `Status: ${data.status}`,
        });
      }

      return data;

    } catch (error) {
      console.error('[usePixPayment] Refund exception:', error);
      toast({
        variant: "destructive",
        title: "Erro",
        description: "Falha na comunicação com o servidor.",
      });
      return null;
    }
  }, [session, toast]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopPolling();
    };
  }, [stopPolling]);

  return {
    // State
    isCreating,
    isChecking,
    cobData,
    paymentStatus,
    // Actions
    createCob,
    checkStatus,
    startPolling,
    stopPolling,
    requestRefund,
  };
}
