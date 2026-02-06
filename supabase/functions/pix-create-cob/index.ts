import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CreateCobRequest {
  company_id: string;
  valor: number;
  descricao?: string;
  devedor?: {
    cpf?: string;
    cnpj?: string;
    nome: string;
  };
  expiracao?: number; // seconds, default 3600 (1 hour)
  transaction_id?: string; // If updating existing transaction
}

interface CobResponse {
  txid: string;
  revisao: number;
  loc?: {
    id: number;
    location: string;
  };
  location?: string;
  status: string;
  calendario: {
    criacao: string;
    expiracao: number;
  };
  valor: {
    original: string;
  };
  chave: string;
  pixCopiaECola?: string;
}

// Generate txid according to BCB standard (26-35 alphanumeric chars)
function generateTxId(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 35; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Authenticate user
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace('Bearer ', '');
    const { data: claims, error: authError } = await supabase.auth.getClaims(token);
    
    if (authError || !claims?.claims) {
      return new Response(
        JSON.stringify({ error: 'Invalid token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const userId = claims.claims.sub as string;

    // Get request body
    const body: CreateCobRequest = await req.json();
    const { company_id, valor, descricao, devedor, expiracao = 3600, transaction_id } = body;

    if (!company_id || !valor) {
      return new Response(
        JSON.stringify({ error: 'company_id and valor are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[pix-create-cob] Creating cob for company: ${company_id}, valor: ${valor}`);

    // Get Pix config
    const { data: config, error: configError } = await supabase
      .from('pix_configs')
      .select('*')
      .eq('company_id', company_id)
      .eq('is_active', true)
      .single();

    if (configError || !config) {
      return new Response(
        JSON.stringify({ error: 'Pix configuration not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get auth token
    const authResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/pix-auth`, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ company_id }),
    });

    if (!authResponse.ok) {
      const authError = await authResponse.text();
      console.error('[pix-create-cob] Auth failed:', authError);
      return new Response(
        JSON.stringify({ error: 'Failed to authenticate with Pix provider' }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { access_token } = await authResponse.json();

    // Generate txid
    const txid = generateTxId();
    console.log(`[pix-create-cob] Generated txid: ${txid}`);

    // Build cob payload
    const cobPayload: any = {
      calendario: {
        expiracao: expiracao,
      },
      valor: {
        original: valor.toFixed(2),
      },
      chave: config.pix_key,
    };

    if (descricao) {
      cobPayload.solicitacaoPagador = descricao.substring(0, 140);
    }

    if (devedor) {
      cobPayload.devedor = {};
      if (devedor.cpf) cobPayload.devedor.cpf = devedor.cpf.replace(/\D/g, '');
      if (devedor.cnpj) cobPayload.devedor.cnpj = devedor.cnpj.replace(/\D/g, '');
      if (devedor.nome) cobPayload.devedor.nome = devedor.nome.substring(0, 25);
    }

    console.log('[pix-create-cob] Sending to provider:', JSON.stringify(cobPayload));

    // Create cob on Pix provider
    const cobUrl = `${config.base_url}/cob/${txid}`;
    const cobResponse = await fetch(cobUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(cobPayload),
    });

    if (!cobResponse.ok) {
      const errorText = await cobResponse.text();
      console.error('[pix-create-cob] Provider error:', errorText);
      return new Response(
        JSON.stringify({ 
          error: 'Failed to create Pix charge',
          provider_error: errorText,
          status: cobResponse.status
        }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const cobData: CobResponse = await cobResponse.json();
    console.log('[pix-create-cob] Cob created:', JSON.stringify(cobData));

    // Calculate expiration timestamp
    const expirationDate = new Date(Date.now() + expiracao * 1000);

    // Save or update transaction in database using service role
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const transactionData = {
      company_id,
      created_by: userId,
      amount: valor,
      status: 'pending',
      pix_type: 'key' as const,
      pix_key: config.pix_key,
      pix_key_type: config.pix_key_type,
      description: descricao,
      beneficiary_name: devedor?.nome,
      beneficiary_document: devedor?.cpf || devedor?.cnpj,
      pix_txid: txid,
      pix_location: cobData.location || cobData.loc?.location,
      pix_copia_cola: cobData.pixCopiaECola,
      pix_expiration: expirationDate.toISOString(),
      pix_provider_response: cobData,
    };

    let finalTransactionId: string;

    if (transaction_id) {
      // Update existing transaction
      const { error: updateError } = await supabaseAdmin
        .from('transactions')
        .update(transactionData)
        .eq('id', transaction_id);

      if (updateError) {
        console.error('[pix-create-cob] Failed to update transaction:', updateError);
      }
      finalTransactionId = transaction_id;
    } else {
      // Create new transaction
      const { data: newTransaction, error: insertError } = await supabaseAdmin
        .from('transactions')
        .insert(transactionData)
        .select('id')
        .single();

      if (insertError) {
        console.error('[pix-create-cob] Failed to create transaction:', insertError);
        return new Response(
          JSON.stringify({ error: 'Failed to save transaction' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      finalTransactionId = newTransaction.id;
    }

    // Log to audit
    await supabaseAdmin.from('audit_logs').insert({
      user_id: userId,
      company_id,
      entity_type: 'transaction',
      entity_id: finalTransactionId,
      action: 'pix_cob_created',
      new_data: { txid, valor, status: 'pending' },
    });

    return new Response(
      JSON.stringify({
        success: true,
        transaction_id: finalTransactionId,
        txid,
        location: cobData.location || cobData.loc?.location,
        pix_copia_cola: cobData.pixCopiaECola,
        status: cobData.status,
        expiration: expirationDate.toISOString(),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[pix-create-cob] Error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
