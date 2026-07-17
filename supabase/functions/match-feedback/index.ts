// Обратная связь по выбору кандидата в сравнении.
// { action: 'record', sourceMarketplace, sourceProductId, targetMarketplace,
//   candidateProductId, candidateUrl, accepted?, matchConfidence?, priority? }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { corsHeaders, jsonResponse } from '../_shared/utils.ts';

const VALID = ['wildberries', 'ozon', 'yandex_market'];

function serviceClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Method not allowed' }, 405);
  }

  try {
    const body = await req.json();
    const action = String(body.action ?? 'record');
    const sourceMarketplace = String(body.sourceMarketplace ?? '');
    const sourceProductId = String(body.sourceProductId ?? '').slice(0, 64);
    const targetMarketplace = String(body.targetMarketplace ?? '');
    const candidateProductId = String(body.candidateProductId ?? '').slice(0, 64);
    const candidateUrl = String(body.candidateUrl ?? '').slice(0, 500);

    if (!VALID.includes(sourceMarketplace) || !VALID.includes(targetMarketplace)) {
      return jsonResponse({ ok: false, error: 'Invalid marketplace' }, 400);
    }
    if (!sourceProductId || !candidateProductId || !candidateUrl) {
      return jsonResponse({ ok: false, error: 'Missing fields' }, 400);
    }

    if (action !== 'record') {
      return jsonResponse({ ok: false, error: 'Unknown action' }, 400);
    }

    const supabase = serviceClient();
    const { error } = await supabase.from('match_feedback').insert({
      source_marketplace: sourceMarketplace,
      source_product_id: sourceProductId,
      target_marketplace: targetMarketplace,
      candidate_product_id: candidateProductId,
      candidate_url: candidateUrl,
      accepted: body.accepted !== false,
      match_confidence:
        body.matchConfidence != null ? Math.round(Number(body.matchConfidence)) : null,
      priority: body.priority != null ? Math.round(Number(body.priority)) : null,
    });

    if (error) {
      console.error('match_feedback insert', error);
      return jsonResponse({ ok: false, error: 'Write failed' }, 500);
    }

    return jsonResponse({ ok: true });
  } catch (error) {
    console.error('match-feedback error', error);
    return jsonResponse({ ok: false, error: 'Server error' }, 500);
  }
});
