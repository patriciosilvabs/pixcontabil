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
 * Returns two separate lists:
 * - blockingReceipts: completed transactions missing a manual receipt (blocks new payments)
 * - stuckTransactions: old pending transactions needing status sync (does NOT block)
 */
export function usePendingReceipts() {
  const { user, currentCompany } = useAuth();
  const [blockingReceipts, setBlockingReceipts] = useState<PendingReceipt[]>([]);
  const [stuckTransactions, setStuckTransactions] = useState<PendingReceipt[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!user?.id || !currentCompany?.id) {
      setBlockingReceipts([]);
      setStuckTransactions([]);
      setIsLoading(false);
      return;
    }

    try {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const effectiveSince = thirtyDaysAgo > RECEIPT_CUTOFF_DATE ? thirtyDaysAgo : RECEIPT_CUTOFF_DATE;

      // Get completed transactions without manual receipt
      const { data: completedData } = await supabase
        .from("transactions")
        .select("id, beneficiary_name, amount, pix_type, created_at, description, status, receipt_required, receipts(id, ocr_data)")
        .eq("company_id", currentCompany.id)
        .eq("created_by", user.id)
        .eq("status", "completed")
        .eq("receipt_required", true)
        .gt("amount", 0.01)
        .gte("created_at", effectiveSince)
        .order("created_at", { ascending: false })
        .limit(100);

      // Get stuck transactions (pending > 5 min)
      const { data: stuckData } = await supabase
        .from("transactions")
        .select("id, beneficiary_name, amount, pix_type, created_at, description, status")
        .eq("company_id", currentCompany.id)
        .eq("created_by", user.id)
        .eq("status", "pending")
        .eq("receipt_required", true)
        .gt("amount", 0.01)
        .lte("created_at", fiveMinAgo)
        .gte("created_at", effectiveSince)
        .order("created_at", { ascending: false })
        .limit(20);

      const missingManual = (completedData || []).filter((tx: any) => {
        const receipts = Array.isArray(tx.receipts) ? tx.receipts : [];
        const hasManual = receipts.some(
          (r: any) => !r?.ocr_data?.auto_generated
        );
        return !hasManual;
      });

      const blocking = missingManual.map((tx: any) => ({
        id: tx.id,
        beneficiary_name: tx.beneficiary_name,
        amount: Number(tx.amount),
        pix_type: tx.pix_type,
        created_at: tx.created_at,
        description: tx.description ?? null,
        status: "completed" as string,
      }));

      const stuck = (stuckData || []).map((tx: any) => ({
        id: tx.id,
        beneficiary_name: tx.beneficiary_name,
        amount: Number(tx.amount),
        pix_type: tx.pix_type,
        created_at: tx.created_at,
        description: tx.description ?? null,
        status: "pending" as string,
      }));

      setBlockingReceipts(blocking);
      setStuckTransactions(stuck);
    } catch (err) {
      console.error("[usePendingReceipts] Error:", err);
    } finally {
      setIsLoading(false);
    }
  }, [user?.id, currentCompany?.id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Legacy compat: "pending" = blockingReceipts only (what blocks actions)
  // "all" combines both for display purposes
  return {
    /** Only completed transactions missing manual receipt — use for blocking */
    blockingReceipts,
    /** Old pending transactions needing sync — informational only */
    stuckTransactions,
    /** Legacy: same as blockingReceipts */
    pending: blockingReceipts,
    isLoading,
    refresh,
    /** Count of blocking receipts only */
    count: blockingReceipts.length,
    /** Count of stuck transactions */
    stuckCount: stuckTransactions.length,
  };
}
