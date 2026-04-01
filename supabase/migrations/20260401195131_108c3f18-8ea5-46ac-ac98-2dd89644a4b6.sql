
CREATE TABLE public.quick_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  suggested_classification text,
  request_order_number boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.quick_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage quick_tags" ON public.quick_tags
  FOR ALL TO authenticated USING (is_admin(auth.uid()));

CREATE POLICY "Members can view active quick_tags" ON public.quick_tags
  FOR SELECT TO authenticated
  USING (company_id IN (SELECT get_user_companies(auth.uid()) AS get_user_companies));

CREATE TRIGGER update_quick_tags_updated_at
  BEFORE UPDATE ON public.quick_tags
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
