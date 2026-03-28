
-- =============================================================
-- SECURITY HARDENING: Fix RLS policies
-- =============================================================

-- 1. pix_configs: Remove member SELECT policies, keep only admin
DROP POLICY IF EXISTS "Members can select own company pix configs" ON pix_configs;
DROP POLICY IF EXISTS "Members can view pix config safe" ON pix_configs;
DROP POLICY IF EXISTS "Admins can manage pix configs" ON pix_configs;

CREATE POLICY "Admins can manage pix configs"
ON pix_configs FOR ALL
TO authenticated
USING (is_admin(auth.uid()));

-- 2. pix_tokens: Fix from public to authenticated
DROP POLICY IF EXISTS "Admins can manage pix tokens" ON pix_tokens;

CREATE POLICY "Admins can manage pix tokens"
ON pix_tokens FOR ALL
TO authenticated
USING (is_admin(auth.uid()));

-- 3. pix_refunds: Fix from public to authenticated
DROP POLICY IF EXISTS "Admins can manage refunds" ON pix_refunds;
DROP POLICY IF EXISTS "Members can view refunds" ON pix_refunds;

CREATE POLICY "Admins can manage refunds"
ON pix_refunds FOR ALL
TO authenticated
USING (is_admin(auth.uid()));

CREATE POLICY "Members can view refunds"
ON pix_refunds FOR SELECT
TO authenticated
USING (transaction_id IN (
  SELECT id FROM transactions
  WHERE company_id IN (SELECT get_user_companies(auth.uid()))
));

-- 4. pix_webhook_logs: Fix from public to authenticated
DROP POLICY IF EXISTS "Admins can view webhook logs" ON pix_webhook_logs;

CREATE POLICY "Admins can view webhook logs"
ON pix_webhook_logs FOR SELECT
TO authenticated
USING (is_admin(auth.uid()));

-- 5. user_page_permissions: Fix from public to authenticated
DROP POLICY IF EXISTS "Admins can manage page permissions" ON user_page_permissions;
DROP POLICY IF EXISTS "Users can view own permissions" ON user_page_permissions;

CREATE POLICY "Admins can manage page permissions"
ON user_page_permissions FOR ALL
TO authenticated
USING (is_admin(auth.uid()));

CREATE POLICY "Users can view own permissions"
ON user_page_permissions FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- 6. user_feature_permissions: Fix from public to authenticated
DROP POLICY IF EXISTS "Admins can manage feature permissions" ON user_feature_permissions;
DROP POLICY IF EXISTS "Users can view own feature permissions" ON user_feature_permissions;

CREATE POLICY "Admins can manage feature permissions"
ON user_feature_permissions FOR ALL
TO authenticated
USING (is_admin(auth.uid()));

CREATE POLICY "Users can view own feature permissions"
ON user_feature_permissions FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- 7. audit_logs: Remove company_id IS NULL branch
DROP POLICY IF EXISTS "Users can insert audit logs for their companies" ON audit_logs;

CREATE POLICY "Users can insert audit logs for their companies"
ON audit_logs FOR INSERT
TO authenticated
WITH CHECK (
  company_id IS NOT NULL
  AND company_id IN (SELECT get_user_companies(auth.uid()))
);
