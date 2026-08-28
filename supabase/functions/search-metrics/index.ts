// PriceGuard AI — приём метрик поиска (search_metrics).
// user_id из JWT (если авторизован), deviceId — legacy fallback.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { corsHeaders, jsonResponse } from '../_shared/utils.ts';
import { requireAuthUser } from '../_shared/auth.ts';

/** Keep in sync with client `SEARCH_METRICS_ALLOWED_MARKETPLACES` (flush.ts). */
const VALID_MARKETPLACES = [
  'wildberries',
  'ozon',
  'yandex_market',
  'megamarket',
  'aliexpress',
];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Method not allowed' }, 405);
  }

  try {
    const body = await req.json();
    const marketplace = String(body.marketplace ?? '');
    if (!VALID_MARKETPLACES.includes(marketplace)) {
      return jsonResponse({ ok: false, error: 'Invalid marketplace' }, 400);
    }

    const authUser = await requireAuthUser(req, false);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { error } = await supabase.from('search_metrics').insert({
      marketplace,
      search_query: body.searchQuery ? String(body.searchQuery).slice(0, 300) : null,
      success: Boolean(body.success),
      response_time_ms:
        body.responseTimeMs == null ? null : Math.round(Number(body.responseTimeMs)),
      found_product_id: body.foundProductId ? String(body.foundProductId).slice(0, 64) : null,
      user_id: authUser?.id ?? null,
      device_id: body.deviceId ? String(body.deviceId).slice(0, 64) : null,
    });

    if (error) {
      console.error('search_metrics insert', error);
      return jsonResponse({ ok: false, error: 'Insert failed' }, 500);
    }

    return jsonResponse({ ok: true });
  } catch (error) {
    console.error('search-metrics error', error);
    return jsonResponse({ ok: false, error: 'Server error' }, 500);
  }
});
