import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { Database } from "@/integrations/supabase/types";

type PixKeyType = Database["public"]["Enums"]["pix_key_type"];
type PixType = Database["public"]["Enums"]["pix_type"];

export interface RecentPayment {
  pix_key: string;
  pix_key_type: PixKeyType | null;
  pix_type: PixType;
  amount: number;
  description: string | null;
  beneficiary_name: string | null;
  beneficiary_document: string | null;
  created_at: string;
  created_by?: string;
  quick_tag_name?: string | null;
}

interface UseRecentPaymentsOptions {
  limit?: number;
  enabled?: boolean;
}

export function useRecentPayments({ limit = 10, enabled = true }: UseRecentPaymentsOptions = {}) {
  const { currentCompany, isAdmin, user } = useAuth();
  const [payments, setPayments] = useState<RecentPayment[]>([]);
  const [profileMap, setProfileMap] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!enabled || !currentCompany?.id) {
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    const fetchRecent = async () => {
      setIsLoading(true);
      let query = supabase
        .from("transactions")
        .select("pix_key, pix_key_type, pix_type, amount, description, beneficiary_name, beneficiary_document, created_at, created_by, quick_tag_name")
        .eq("company_id", currentCompany.id)
        .eq("status", "completed")
        .in("pix_type", ["key", "copy_paste", "qrcode"])
        .not("pix_key", "is", null)
        .order("created_at", { ascending: false })
        .limit(60);

      if (!isAdmin && user) {
        query = query.eq("created_by", user.id);
      }

      const [txResult, profileRes] = await Promise.all([
        query,
        supabase.from("profiles").select("user_id, full_name"),
      ]);

      if (cancelled) return;

      if (profileRes.data) {
        const map: Record<string, string> = {};
        profileRes.data.forEach((p: any) => { map[p.user_id] = p.full_name; });
        setProfileMap(map);
      }

      if (txResult.error) {
        console.error("[useRecentPayments] Error:", txResult.error);
        setIsLoading(false);
        return;
      }

      const grouped = (txResult.data || []).reduce<Record<string, RecentPayment>>((acc, tx) => {
        const key = tx.pix_key!;
        if (!acc[key]) acc[key] = tx as RecentPayment;
        return acc;
      }, {});

      setPayments(Object.values(grouped).slice(0, limit));
      setIsLoading(false);
    };

    fetchRecent();
    return () => { cancelled = true; };
  }, [currentCompany?.id, isAdmin, user?.id, enabled, limit]);

  return { payments, profileMap, isLoading };
}
