import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body = await req.json();
    const {
      event_type,
      ip_address,
      user_id,
      company_id,
      user_agent,
      metadata,
      severity,
    } = body;

    if (!event_type || !ip_address) {
      return new Response(
        JSON.stringify({ error: "event_type and ip_address are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 1. Insert event
    const { data: event, error: insertErr } = await supabaseAdmin
      .from("security_events")
      .insert({
        event_type,
        ip_address,
        user_id: user_id || null,
        company_id: company_id || null,
        user_agent: user_agent || null,
        metadata: metadata || {},
        severity: severity || "medium",
      })
      .select("id")
      .single();

    if (insertErr) {
      console.error("Insert error:", insertErr);
      return new Response(
        JSON.stringify({ error: "Failed to insert event" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Check if IP is already blocked
    const { data: existingBlock } = await supabaseAdmin
      .from("ip_blocks")
      .select("id")
      .eq("ip_address", ip_address)
      .eq("is_active", true)
      .maybeSingle();

    const alerts: any[] = [];

    // 3. Brute Force: 5+ login_failed from same IP in 10 min
    if (event_type === "login_failed") {
      const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const { data: recentFails } = await supabaseAdmin
        .from("security_events")
        .select("id")
        .eq("event_type", "login_failed")
        .eq("ip_address", ip_address)
        .gte("created_at", tenMinAgo);

      if (recentFails && recentFails.length >= 5) {
        const alert = {
          alert_type: "brute_force",
          severity: "critical",
          title: `Ataque de força bruta detectado`,
          description: `${recentFails.length} tentativas de login falhas do IP ${ip_address} nos últimos 10 minutos`,
          source_ip: ip_address,
          target_user_id: user_id || null,
          company_id: company_id || null,
          related_event_ids: recentFails.map((e: any) => e.id),
        };
        alerts.push(alert);

        // Auto-block IP
        if (!existingBlock) {
          await supabaseAdmin.from("ip_blocks").upsert(
            {
              ip_address,
              reason: `Auto-bloqueio: ${recentFails.length} tentativas de login falhas em 10 min`,
              blocked_by: user_id || "00000000-0000-0000-0000-000000000000",
              is_active: true,
            },
            { onConflict: "ip_address" }
          );
        }
      }
    }

    // 4. User Enumeration: 10+ attempts with different emails from same IP in 5 min
    if (event_type === "login_failed" || event_type === "user_enumeration") {
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const { data: recentAttempts } = await supabaseAdmin
        .from("security_events")
        .select("id, metadata")
        .in("event_type", ["login_failed", "user_enumeration"])
        .eq("ip_address", ip_address)
        .gte("created_at", fiveMinAgo);

      if (recentAttempts && recentAttempts.length >= 10) {
        const uniqueEmails = new Set(
          recentAttempts
            .map((e: any) => e.metadata?.email)
            .filter(Boolean)
        );
        if (uniqueEmails.size >= 5) {
          alerts.push({
            alert_type: "user_enumeration",
            severity: "high",
            title: `Enumeração de usuários detectada`,
            description: `${uniqueEmails.size} emails diferentes tentados do IP ${ip_address} em 5 min`,
            source_ip: ip_address,
            company_id: company_id || null,
            related_event_ids: recentAttempts.map((e: any) => e.id),
          });
        }
      }
    }

    // 5. Repeated Access Denied: 5+ from same user in 5 min
    if (event_type === "access_denied" && user_id) {
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const { data: deniedEvents } = await supabaseAdmin
        .from("security_events")
        .select("id")
        .eq("event_type", "access_denied")
        .eq("user_id", user_id)
        .gte("created_at", fiveMinAgo);

      if (deniedEvents && deniedEvents.length >= 5) {
        alerts.push({
          alert_type: "repeated_access_denied",
          severity: "medium",
          title: `Acesso proibido repetido`,
          description: `Usuário tentou acessar recursos não autorizados ${deniedEvents.length} vezes em 5 min`,
          source_ip: ip_address,
          target_user_id: user_id,
          company_id: company_id || null,
          related_event_ids: deniedEvents.map((e: any) => e.id),
        });
      }
    }

    // 6. Rate Limit: 50+ events from same IP in 1 min
    const oneMinAgo = new Date(Date.now() - 60 * 1000).toISOString();
    const { data: rateLimitEvents } = await supabaseAdmin
      .from("security_events")
      .select("id")
      .eq("ip_address", ip_address)
      .gte("created_at", oneMinAgo);

    if (rateLimitEvents && rateLimitEvents.length >= 50) {
      alerts.push({
        alert_type: "rate_limit",
        severity: "high",
        title: `Rate limit excedido`,
        description: `${rateLimitEvents.length} eventos do IP ${ip_address} em 1 minuto`,
        source_ip: ip_address,
        company_id: company_id || null,
        related_event_ids: rateLimitEvents.slice(0, 20).map((e: any) => e.id),
      });

      if (!existingBlock) {
        await supabaseAdmin.from("ip_blocks").upsert(
          {
            ip_address,
            reason: `Auto-bloqueio: rate limit excedido (${rateLimitEvents.length} eventos/min)`,
            blocked_by: user_id || "00000000-0000-0000-0000-000000000000",
            is_active: true,
          },
          { onConflict: "ip_address" }
        );
      }
    }

    // 7. Invalid Token: 5+ from same IP in 10 min
    if (event_type === "invalid_token") {
      const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const { data: tokenEvents } = await supabaseAdmin
        .from("security_events")
        .select("id")
        .eq("event_type", "invalid_token")
        .eq("ip_address", ip_address)
        .gte("created_at", tenMinAgo);

      if (tokenEvents && tokenEvents.length >= 5) {
        alerts.push({
          alert_type: "invalid_token_repeat",
          severity: "high",
          title: `Tokens inválidos repetidos`,
          description: `${tokenEvents.length} tentativas com token inválido do IP ${ip_address} em 10 min`,
          source_ip: ip_address,
          company_id: company_id || null,
          related_event_ids: tokenEvents.map((e: any) => e.id),
        });
      }
    }

    // Insert alerts
    if (alerts.length > 0) {
      await supabaseAdmin.from("security_alerts").insert(alerts);
    }

    return new Response(
      JSON.stringify({
        event_id: event.id,
        alerts_generated: alerts.length,
        ip_blocked: !!existingBlock || alerts.some((a) => a.alert_type === "brute_force" || a.alert_type === "rate_limit"),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Security analyze error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
