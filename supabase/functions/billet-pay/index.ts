import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Billet payment is temporarily disabled after migration from ONZ to EFI Pay.
// EFI has its own billet API but it will be implemented in a future phase.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  return new Response(
    JSON.stringify({ 
      error: 'Pagamento de boletos está temporariamente desabilitado durante a migração para EFI Pay.',
      hint: 'Esta funcionalidade será reativada em breve com suporte ao provedor EFI Pay.'
    }),
    { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
});
