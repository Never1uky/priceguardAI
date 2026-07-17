import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { corsHeaders, jsonResponse } from '../_shared/utils.ts';

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
    const status = String(body.status ?? '');
    const source = String(body.source ?? 'scrape');

    if (!['wildberries', 'ozon', 'yandex_market'].includes(marketplace)) {
      return jsonResponse({ ok: false, error: 'Invalid marketplace' }, 400);
    }

    if (!['original', 'not_original', 'unknown'].includes(status)) {
      return jsonResponse({ ok: false, error: 'Invalid status' }, 400);
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { error } = await supabase.from('authenticity_events').insert({
      marketplace,
      article: body.article ? String(body.article).slice(0, 32) : null,
      status,
      source,
      extension_version: body.extensionVersion ? String(body.extensionVersion).slice(0, 16) : null,
    });

    if (error) {
      console.error('authenticity insert', error);
      return jsonResponse({ ok: false, error: 'Insert failed' }, 500);
    }

    return jsonResponse({ ok: true });
  } catch (error) {
    console.error(error);
    return jsonResponse({ ok: false, error: 'Server error' }, 500);
  }
});
