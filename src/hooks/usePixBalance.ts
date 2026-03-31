import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

interface PixBalanceState {
  balance: number | null;
  isLoading: boolean;
  isAvailable: boolean;
  provider: string | null;
  message: string | null;
  error: string | null;
}

export function usePixBalance(options?: { enabled?: boolean }) {
  const enabled = options?.enabled ?? true;
  const { currentCompany } = useAuth();
  const [state, setState] = useState<PixBalanceState>({
    balance: null,
    isLoading: true,
    isAvailable: false,
    provider: null,
    message: null,
    error: null,
  });
  const [isRefetching, setIsRefetching] = useState(false);

  const fetchBalance = useCallback(async () => {
    if (!currentCompany?.id) {
      setState(prev => ({ ...prev, isLoading: false }));
      return;
    }

    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        setState(prev => ({
          ...prev,
          isLoading: false,
          error: 'Sessão expirada. Faça login novamente.',
        }));
        return;
      }

      const response = await supabase.functions.invoke('pix-balance', {
        body: { company_id: currentCompany.id },
      });

      if (response.error) {
        console.error('[usePixBalance] Error:', response.error);
        const isUnauthorized = response.error.message?.includes('Invalid token') || response.error.context?.status === 401;

        setState(prev => ({
          ...prev,
          isLoading: false,
          error: isUnauthorized ? 'Sessão expirada. Faça login novamente.' : response.error.message,
        }));
        return;
      }

      const data = response.data;
      setState({
        balance: data.balance,
        isLoading: false,
        isAvailable: data.available ?? false,
        provider: data.provider ?? null,
        message: data.message ?? null,
        error: data.error ?? null,
      });
    } catch (err: any) {
      console.error('[usePixBalance] Exception:', err);
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: err.message,
      }));
    }
  }, [currentCompany?.id]);

  useEffect(() => {
    if (enabled) {
      fetchBalance();
    } else {
      setState(prev => ({ ...prev, isLoading: false }));
    }
  }, [fetchBalance, enabled]);

  const manualRefetch = useCallback(async () => {
    setIsRefetching(true);
    await fetchBalance();
    setIsRefetching(false);
  }, [fetchBalance]);

  return { ...state, refetch: manualRefetch, isRefetching };
}
