import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { RECEIPT_CUTOFF_DATE } from "@/constants/app";

export interface PendingReceipt {
  id: string;
  beneficiary_name: string | null;
  amount: number;
  pix_type: string;
  created_at: string;
  description: string | null;
  status: string;
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
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

      // Get completed transactions without manual receipt
      const { data: completedData } = await supabase
        .from("transactions")
        .select("id, beneficiary_name, amount, pix_type, created_at, description, status, receipts(id, ocr_data)")
        .eq("company_id", currentCompany.id)
        .eq("created_by", user.id)
        .eq("status", "completed")
        .gt("amount", 0.01)
        .gte("created_at", thirtyDaysAgo)
        .order("created_at", { ascending: false })
        .limit(100);

      // Get stuck transactions (pending > 5 min)
      const { data: stuckData } = await supabase
        .from("transactions")
        .select("id, beneficiary_name, amount, pix_type, created_at, description, status")
        .eq("company_id", currentCompany.id)
        .eq("created_by", user.id)
        .eq("status", "pending")
        .gt("amount", 0.01)
        .lte("created_at", fiveMinAgo)
        .gte("created_at", thirtyDaysAgo)
        .order("created_at", { ascending: false })
        .limit(20);

      const missingManual = (completedData || []).filter((tx: any) => {
        const receipts = Array.isArray(tx.receipts) ? tx.receipts : [];
        const hasManual = receipts.some(
          (r: any) => !r?.ocr_data?.auto_generated
        );
        return !hasManual;
      });

      const allPending = [
        ...missingManual.map((tx: any) => ({
          id: tx.id,
          beneficiary_name: tx.beneficiary_name,
          amount: Number(tx.amount),
          pix_type: tx.pix_type,
          created_at: tx.created_at,
          description: tx.description ?? null,
          status: "completed" as string,
        })),
        ...(stuckData || []).map((tx: any) => ({
          id: tx.id,
          beneficiary_name: tx.beneficiary_name,
          amount: Number(tx.amount),
          pix_type: tx.pix_type,
          created_at: tx.created_at,
          description: tx.description ?? null,
          status: "pending" as string,
        })),
      ];

      setPending(allPending);
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
