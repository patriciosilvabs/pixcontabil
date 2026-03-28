import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

async function validateAdmin(req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) throw new Error("No authorization header");

  const token = authHeader.replace("Bearer ", "");
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const apiKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;

  const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: apiKey },
  });

  if (!res.ok) throw new Error("Invalid token");
  const user = await res.json();

  const supabaseAdmin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: isAdmin } = await supabaseAdmin.rpc("is_admin", { _user_id: user.id });
  if (!isAdmin) throw new Error("Not admin");

  return { user, supabaseAdmin };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { user, supabaseAdmin } = await validateAdmin(req);
    const url = new URL(req.url);
    const path = url.pathname.replace(/^\/security-admin\/?/, "");

    // GET metrics
    if (req.method === "GET" && path === "metrics") {
      const now = new Date();
      const h24 = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

      const [eventsRes, alertsRes, blocksRes, criticalRes] = await Promise.all([
        supabaseAdmin
          .from("security_events")
          .select("id", { count: "exact", head: true })
          .gte("created_at", h24),
        supabaseAdmin
          .from("security_alerts")
          .select("id", { count: "exact", head: true })
          .eq("status", "open"),
        supabaseAdmin
          .from("ip_blocks")
          .select("id", { count: "exact", head: true })
          .eq("is_active", true),
        supabaseAdmin
          .from("security_alerts")
          .select("id", { count: "exact", head: true })
          .eq("severity", "critical")
          .eq("status", "open"),
      ]);

      return new Response(
        JSON.stringify({
          events_24h: eventsRes.count || 0,
          open_alerts: alertsRes.count || 0,
          blocked_ips: blocksRes.count || 0,
          critical_alerts: criticalRes.count || 0,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // GET events
    if (req.method === "GET" && path === "events") {
      const eventType = url.searchParams.get("event_type");
      const severity = url.searchParams.get("severity");
      const limit = parseInt(url.searchParams.get("limit") || "50");

      let query = supabaseAdmin
        .from("security_events")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit);

      if (eventType) query = query.eq("event_type", eventType);
      if (severity) query = query.eq("severity", severity);

      const { data, error } = await query;
      if (error) throw error;

      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // GET alerts
    if (req.method === "GET" && path === "alerts") {
      const status = url.searchParams.get("status");
      const limit = parseInt(url.searchParams.get("limit") || "50");

      let query = supabaseAdmin
        .from("security_alerts")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit);

      if (status) query = query.eq("status", status);

      const { data, error } = await query;
      if (error) throw error;

      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // GET ip-blocks
    if (req.method === "GET" && path === "ip-blocks") {
      const { data, error } = await supabaseAdmin
        .from("ip_blocks")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;

      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // POST resolve alert
    if (req.method === "POST" && path.startsWith("alerts/") && path.endsWith("/resolve")) {
      const alertId = path.split("/")[1];
      const { error } = await supabaseAdmin
        .from("security_alerts")
        .update({
          status: "resolved",
          resolved_by: user.id,
          resolved_at: new Date().toISOString(),
        })
        .eq("id", alertId);

      if (error) throw error;

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // POST dismiss alert
    if (req.method === "POST" && path.startsWith("alerts/") && path.endsWith("/dismiss")) {
      const alertId = path.split("/")[1];
      const { error } = await supabaseAdmin
        .from("security_alerts")
        .update({
          status: "dismissed",
          resolved_by: user.id,
          resolved_at: new Date().toISOString(),
        })
        .eq("id", alertId);

      if (error) throw error;

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // POST ip-blocks (block IP)
    if (req.method === "POST" && path === "ip-blocks") {
      const { ip_address, reason, expires_at } = await req.json();
      if (!ip_address || !reason) {
        return new Response(
          JSON.stringify({ error: "ip_address and reason are required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { error } = await supabaseAdmin.from("ip_blocks").upsert(
        {
          ip_address,
          reason,
          blocked_by: user.id,
          is_active: true,
          expires_at: expires_at || null,
        },
        { onConflict: "ip_address" }
      );

      if (error) throw error;

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // DELETE ip-blocks/:id (unblock)
    if (req.method === "DELETE" && path.startsWith("ip-blocks/")) {
      const blockId = path.split("/")[1];
      const { error } = await supabaseAdmin
        .from("ip_blocks")
        .update({ is_active: false })
        .eq("id", blockId);

      if (error) throw error;

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("Security admin error:", err);
    const status = err.message === "Not admin" || err.message === "Invalid token" ? 403 : 500;
    return new Response(
      JSON.stringify({ error: err.message }),
      { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
