import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Billet receipt is temporarily disabled after migration from ONZ to EFI Pay.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  return new Response(
    JSON.stringify({ 
      error: 'Comprovante de boleto está temporariamente desabilitado durante a migração para EFI Pay.',
      hint: 'Esta funcionalidade será reativada em breve.'
    }),
    { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
});
