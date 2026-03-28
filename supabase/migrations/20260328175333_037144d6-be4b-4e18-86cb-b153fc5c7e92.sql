
DROP POLICY "Admins can insert security events" ON public.security_events;

CREATE POLICY "Service can insert security events"
  ON public.security_events FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() OR public.is_admin(auth.uid()));
