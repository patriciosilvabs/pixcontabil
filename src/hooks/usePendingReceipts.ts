import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface PendingReceipt {
  id: string;
  beneficiary_name: string | null;
  amount: number;
  pix_type: string;
}

/**
 * Checks if the current user has pending receipts (completed transactions
 * that have no manual receipt attached — ALL pix_types included).
 */
export function usePendingReceipts() {
  const { user, currentCompany } = useAuth();
  const [pending, setPending] = useState<PendingReceipt[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!user?.id || !currentCompany?.id) {
      setPending([]);
      setIsLoading(false);
      return;
    }

    try {
      // Get ALL completed transactions by the current user (including pix_type='key')
      const { data } = await supabase
        .from("transactions")
        .select("id, beneficiary_name, amount, pix_type, receipts(id, ocr_data)")
        .eq("company_id", currentCompany.id)
        .eq("created_by", user.id)
        .eq("status", "completed")
        .order("created_at", { ascending: false })
        .limit(10);

      if (!data) {
        setPending([]);
        return;
      }

      const missingManual = data.filter((tx: any) => {
        const receipts = Array.isArray(tx.receipts) ? tx.receipts : [];
        const hasManual = receipts.some(
          (r: any) => !r?.ocr_data?.auto_generated
        );
        return !hasManual;
      });

      setPending(
        missingManual.map((tx: any) => ({
          id: tx.id,
          beneficiary_name: tx.beneficiary_name,
          amount: Number(tx.amount),
          pix_type: tx.pix_type,
        }))
      );
    } catch (err) {
      console.error("[usePendingReceipts] Error:", err);
    } finally {
      setIsLoading(false);
    }
  }, [user?.id, currentCompany?.id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { pending, isLoading, refresh, count: pending.length };
}
