import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface QuickTag {
  id: string;
  company_id: string;
  name: string;
  suggested_classification: string | null;
  request_order_number: boolean;
  receipt_required: boolean;
  is_active: boolean;
  sort_order: number;
  description_placeholder: string | null;
  description_required: boolean;
  created_at: string;
  updated_at: string;
}

export function useQuickTags() {
  const { currentCompany } = useAuth();
  const [tags, setTags] = useState<QuickTag[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchTags = useCallback(async () => {
    if (!currentCompany?.id) {
      setTags([]);
      return;
    }
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from("quick_tags" as any)
        .select("*")
        .eq("company_id", currentCompany.id)
        .eq("is_active", true)
        .order("sort_order", { ascending: true });

      if (error) throw error;
      setTags((data as any[] as QuickTag[]) || []);
    } catch {
      setTags([]);
    } finally {
      setIsLoading(false);
    }
  }, [currentCompany?.id]);

  useEffect(() => {
    fetchTags();
  }, [fetchTags]);

  return { tags, isLoading, refetch: fetchTags };
}

export function useQuickTagsAdmin() {
  const { currentCompany } = useAuth();
  const [tags, setTags] = useState<QuickTag[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchAll = useCallback(async () => {
    if (!currentCompany?.id) {
      setTags([]);
      return;
    }
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from("quick_tags" as any)
        .select("*")
        .eq("company_id", currentCompany.id)
        .order("sort_order", { ascending: true });

      if (error) throw error;
      setTags((data as any[] as QuickTag[]) || []);
    } catch {
      setTags([]);
    } finally {
      setIsLoading(false);
    }
  }, [currentCompany?.id]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const createTag = async (tag: { name: string; suggested_classification?: string | null; request_order_number?: boolean; receipt_required?: boolean; sort_order?: number; description_placeholder?: string | null; description_required?: boolean }) => {
    if (!currentCompany?.id) return;
    const { error } = await supabase
      .from("quick_tags" as any)
      .insert({
        company_id: currentCompany.id,
        name: tag.name,
        suggested_classification: tag.suggested_classification || null,
        request_order_number: tag.request_order_number ?? false,
        receipt_required: tag.receipt_required ?? true,
        sort_order: tag.sort_order ?? tags.length,
        description_placeholder: tag.description_placeholder || null,
        description_required: tag.description_required ?? true,
      } as any);
    if (error) throw error;
    await fetchAll();
  };

  const updateTag = async (id: string, updates: Partial<Pick<QuickTag, "name" | "suggested_classification" | "request_order_number" | "receipt_required" | "is_active" | "sort_order" | "description_placeholder" | "description_required">>) => {
    const { error } = await supabase
      .from("quick_tags" as any)
      .update(updates as any)
      .eq("id", id);
    if (error) throw error;
    await fetchAll();
  };

  const deleteTag = async (id: string) => {
    const { error } = await supabase
      .from("quick_tags" as any)
      .delete()
      .eq("id", id);
    if (error) throw error;
    await fetchAll();
  };

  return { tags, isLoading, refetch: fetchAll, createTag, updateTag, deleteTag };
}
