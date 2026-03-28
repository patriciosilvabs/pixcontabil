
-- 1. security_events
CREATE TABLE public.security_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  user_id uuid,
  event_type text NOT NULL,
  severity text NOT NULL DEFAULT 'medium',
  ip_address text NOT NULL,
  user_agent text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.security_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view security events"
  ON public.security_events FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE POLICY "Admins can insert security events"
  ON public.security_events FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE INDEX idx_security_events_ip ON public.security_events(ip_address, created_at);
CREATE INDEX idx_security_events_type ON public.security_events(event_type, created_at);
CREATE INDEX idx_security_events_user ON public.security_events(user_id, created_at);

-- 2. security_alerts
CREATE TABLE public.security_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  alert_type text NOT NULL,
  severity text NOT NULL DEFAULT 'medium',
  title text NOT NULL,
  description text NOT NULL,
  source_ip text,
  target_user_id uuid,
  related_event_ids uuid[] DEFAULT '{}',
  status text NOT NULL DEFAULT 'open',
  resolved_by uuid,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.security_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage security alerts"
  ON public.security_alerts FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE INDEX idx_security_alerts_status ON public.security_alerts(status, created_at);

-- 3. ip_blocks
CREATE TABLE public.ip_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ip_address text NOT NULL UNIQUE,
  reason text NOT NULL,
  blocked_by uuid NOT NULL,
  blocked_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ip_blocks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage ip blocks"
  ON public.ip_blocks FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE INDEX idx_ip_blocks_active ON public.ip_blocks(ip_address, is_active);

-- Enable realtime for security_alerts
ALTER PUBLICATION supabase_realtime ADD TABLE public.security_alerts;
