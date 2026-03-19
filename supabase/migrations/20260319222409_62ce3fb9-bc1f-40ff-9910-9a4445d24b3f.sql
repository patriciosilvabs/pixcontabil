
-- ============================================================
-- WEBHOOK GATEWAY: Tables for multi-app webhook routing
-- ============================================================

-- 1. Webhook Destinations (registered apps)
CREATE TABLE public.webhook_destinations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_name text NOT NULL UNIQUE,
  display_name text NOT NULL,
  callback_url text,
  is_active boolean NOT NULL DEFAULT true,
  secret_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.webhook_destinations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage webhook destinations"
  ON public.webhook_destinations FOR ALL
  TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE TRIGGER update_webhook_destinations_updated_at
  BEFORE UPDATE ON public.webhook_destinations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. Payment Registry (maps transactions to originating apps)
CREATE TABLE public.payment_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id text NOT NULL,
  provider text NOT NULL DEFAULT 'pix',
  app_origin text NOT NULL,
  tenant_id text,
  reference_id text,
  company_id uuid REFERENCES public.companies(id),
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_payment_registry_txid_provider UNIQUE (transaction_id, provider)
);

ALTER TABLE public.payment_registry ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage payment registry"
  ON public.payment_registry FOR ALL
  TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE POLICY "Members can view own company payment registry"
  ON public.payment_registry FOR SELECT
  TO authenticated
  USING (company_id IN (SELECT public.get_user_companies(auth.uid())));

CREATE INDEX idx_payment_registry_txid ON public.payment_registry(transaction_id);
CREATE INDEX idx_payment_registry_app ON public.payment_registry(app_origin);

-- 3. Webhook Events (enhanced audit with idempotency and routing)
CREATE TABLE public.webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'pix',
  event_type text NOT NULL,
  transaction_id text,
  idempotency_key text NOT NULL UNIQUE,
  payload jsonb NOT NULL,
  normalized_payload jsonb,
  app_origin text,
  tenant_id text,
  status text NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'processing', 'processed', 'failed', 'unknown_origin')),
  dispatch_status text DEFAULT 'pending' CHECK (dispatch_status IN ('pending', 'dispatched', 'failed', 'skipped')),
  dispatch_response jsonb,
  dispatch_attempts int NOT NULL DEFAULT 0,
  max_retries int NOT NULL DEFAULT 3,
  next_retry_at timestamptz,
  ip_address text,
  error_message text,
  company_id uuid REFERENCES public.companies(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage webhook events"
  ON public.webhook_events FOR ALL
  TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE POLICY "Members can view own company webhook events"
  ON public.webhook_events FOR SELECT
  TO authenticated
  USING (company_id IN (SELECT public.get_user_companies(auth.uid())));

CREATE INDEX idx_webhook_events_txid ON public.webhook_events(transaction_id);
CREATE INDEX idx_webhook_events_status ON public.webhook_events(status);
CREATE INDEX idx_webhook_events_dispatch ON public.webhook_events(dispatch_status) WHERE dispatch_status IN ('pending', 'failed');
CREATE INDEX idx_webhook_events_retry ON public.webhook_events(next_retry_at) WHERE dispatch_status = 'failed' AND next_retry_at IS NOT NULL;
CREATE INDEX idx_webhook_events_created ON public.webhook_events(created_at DESC);
CREATE INDEX idx_webhook_events_idempotency ON public.webhook_events(idempotency_key);
