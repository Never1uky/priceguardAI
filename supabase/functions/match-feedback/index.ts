// Обратная связь по выбору кандидата в сравнении.
// { action: 'record', sourceMarketplace, sourceProductId, targetMarketplace,
//   candidateProductId, candidateUrl, accepted?, matchConfidence?, priority?,
//   sourceTitle?, candidateTitle? }
// При accepted=true и crowd consensus → cross_market_mapping (evidence: multi_user).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { maybePromoteMultiUserMapping } from '../_shared/multi-user-mapping.ts';
import { corsHeaders, jsonResponse } from '../_shared/utils.ts';
import { requireAuthUser } from '../_shared/auth.ts';

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
    const user = await requireAuthUser(req, true);

    const body = await req.json();
    const action = String(body.action ?? 'record');
    const sourceMarketplace = String(body.sourceMarketplace ?? '');
    const sourceProductId = String(body.sourceProductId ?? '').slice(0, 64);
    const targetMarketplace = String(body.targetMarketplace ?? '');
    const candidateProductId = String(body.candidateProductId ?? '').slice(0, 64);
    const candidateUrl = String(body.candidateUrl ?? '').slice(0, 500);
    const sourceTitle = body.sourceTitle ? String(body.sourceTitle).slice(0, 300) : null;
    const candidateTitle = body.candidateTitle
      ? String(body.candidateTitle).slice(0, 300)
      : null;

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
      user_id: user!.id,
      source_title: sourceTitle,
      candidate_title: candidateTitle,
    });

    if (error) {
      console.error('match_feedback insert', error);
      return jsonResponse({ ok: false, error: 'Write failed' }, 500);
    }

    let promoted = false;
    let promoteReason: string | undefined;
    if (body.accepted !== false) {
      const promote = await maybePromoteMultiUserMapping(supabase, {
        sourceMarketplace: sourceMarketplace as 'wildberries' | 'ozon' | 'yandex_market',
        sourceProductId,
        targetMarketplace: targetMarketplace as 'wildberries' | 'ozon' | 'yandex_market',
        candidateProductId,
        candidateUrl,
        matchConfidence:
          body.matchConfidence != null ? Math.round(Number(body.matchConfidence)) : null,
        sourceTitle,
        candidateTitle,
      });
      promoted = promote.promoted;
      promoteReason = promote.reason;
    }

    return jsonResponse({ ok: true, promoted, promoteReason });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg === 'auth_required' || msg === 'invalid_token') {
      return jsonResponse({ ok: false, error: 'Требуется авторизация' }, 401);
    }
    console.error('match-feedback error', error);
    return jsonResponse({ ok: false, error: 'Server error' }, 500);
  }
});
