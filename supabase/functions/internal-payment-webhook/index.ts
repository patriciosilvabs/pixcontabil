import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-webhook-secret",
};

// ========== VALIDATE WEBHOOK SECRET ==========
async function validateSecret(req: Request): Promise<boolean> {
  const secret = req.headers.get("x-webhook-secret");
  if (!secret) return false;

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const { data } = await supabaseAdmin
    .from("webhook_destinations")
    .select("id")
    .eq("app_name", "pixcontabil")
    .eq("secret_key", secret)
    .eq("is_active", true)
    .limit(1);

  return !!(data && data.length > 0);
}

// ========== MAIN HANDLER ==========
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    // 1. Validate secret
    const isValid = await validateSecret(req);
    if (!isValid) {
      console.error("[internal-webhook] Invalid or missing x-webhook-secret");
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Parse payload
    const event = await req.json();
    console.log("[internal-webhook] Received event:", event.event, "txid:", event.transaction_id);

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // 3. Process based on event type
    const eventType = event.event || event.event_type || "";

    if (eventType.includes("confirmed") || eventType.includes("received") || eventType.includes("completed")) {
      await handlePaymentConfirmed(supabaseAdmin, event);
    } else if (eventType.includes("failed") || eventType.includes("rejected")) {
      await handlePaymentFailed(supabaseAdmin, event);
    } else if (eventType.includes("refund")) {
      await handleRefund(supabaseAdmin, event);
    } else {
      console.log("[internal-webhook] Unhandled event type:", eventType);
    }

    // 4. Log to audit
    await supabaseAdmin.from("audit_logs").insert({
      entity_type: "webhook_event",
      entity_id: event.transaction_id,
      action: `internal_webhook_${eventType}`,
      new_data: { event_type: eventType, transaction_id: event.transaction_id, amount: event.amount },
    });

    return new Response(JSON.stringify({ status: "ok", event: eventType }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("[internal-webhook] Error:", e.message);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// ========== HELPERS ==========
function extractBeneficiary(payload: any): { name: string; doc: string } {
  const p = payload || {};
  const name = p?.creditParty?.name || p?.creditor?.name || p?.receiver?.name
    || p?.beneficiary?.name || p?.receiverName || p?.creditorName || '';
  const doc = p?.creditParty?.taxId || p?.creditor?.taxId || p?.receiver?.taxId
    || p?.beneficiary?.document || p?.receiverDocument || p?.creditorTaxId || '';
  return { name: String(name).trim(), doc: String(doc).trim() };
}

// ========== EVENT HANDLERS ==========

async function handlePaymentConfirmed(supabase: any, event: any) {
  const txid = event.transaction_id;
  const e2eid = event.end_to_end_id;

  if (!txid && !e2eid) {
    console.warn("[internal-webhook] No transaction_id or e2eid in confirmed event");
    return;
  }

  // Find transaction by pix_txid or pix_e2eid
  let query = supabase.from("transactions").select("id, status, company_id").limit(1);
  if (txid) query = query.or(`pix_txid.eq.${txid},external_id.eq.${txid}`);
  else query = query.eq("pix_e2eid", e2eid);

  const { data: txns } = await query;
  const tx = txns?.[0];

  if (!tx) {
    console.warn("[internal-webhook] Transaction not found for:", txid || e2eid);
    return;
  }

  if (tx.status === "completed") {
    console.log("[internal-webhook] Transaction already completed:", tx.id);
    return;
  }

  // Extract beneficiary from webhook event
  const ben = extractBeneficiary(event.raw || event);
  const updateData: any = {
    status: "completed",
    paid_at: new Date().toISOString(),
    pix_e2eid: e2eid || undefined,
  };
  if (ben.name) updateData.beneficiary_name = ben.name;
  if (ben.doc) updateData.beneficiary_document = ben.doc;
  await supabase.from("transactions").update(updateData).eq("id", tx.id);

  console.log("[internal-webhook] Transaction confirmed:", tx.id);

  // Generate receipt with correct payload
  try {
    const resp = await fetch(
      `${Deno.env.get("SUPABASE_URL")}/functions/v1/generate-pix-receipt`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        },
        body: JSON.stringify({ transaction_id: tx.id, company_id: tx.company_id }),
      }
    );
    if (!resp.ok) console.warn("[internal-webhook] Receipt generation failed:", await resp.text());
  } catch (e: any) {
    console.warn("[internal-webhook] Receipt generation error:", e.message);
  }
}

async function handlePaymentFailed(supabase: any, event: any) {
  const txid = event.transaction_id;
  if (!txid) return;

  const { data: txns } = await supabase
    .from("transactions")
    .select("id, status")
    .or(`pix_txid.eq.${txid},external_id.eq.${txid}`)
    .limit(1);

  const tx = txns?.[0];
  if (!tx || tx.status === "failed") return;

  await supabase.from("transactions").update({
    status: "failed",
    pix_provider_response: { webhook_error: event.raw || event },
  }).eq("id", tx.id);

  console.log("[internal-webhook] Transaction failed:", tx.id);
}

async function handleRefund(supabase: any, event: any) {
  const e2eid = event.end_to_end_id;
  if (!e2eid) return;

  const { data: refunds } = await supabase
    .from("pix_refunds")
    .select("id, status")
    .eq("e2eid", e2eid)
    .limit(1);

  if (refunds?.[0]) {
    const newStatus = event.status === "confirmed" ? "DEVOLVIDO" : "NAO_REALIZADO";
    await supabase.from("pix_refunds").update({
      status: newStatus,
      refunded_at: newStatus === "DEVOLVIDO" ? new Date().toISOString() : null,
    }).eq("id", refunds[0].id);

    console.log("[internal-webhook] Refund updated:", refunds[0].id, newStatus);
  }
}
