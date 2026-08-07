/**
 * Cron: refresh offers_snapshot + price_current on published SEO pages.
 * Auth: x-cron-secret or Bearer service_role. Never calls AI.
 *
 * POST JSON (optional):
 *   { limit?, offset? }           — batch stale-first (default limit 40)
 *   { slug } | { product_key }    — single page
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { corsHeaders, jsonResponse } from '../_shared/utils.ts';
import { authorizeCronOrServiceRole } from '../_shared/cron-auth.ts';
import { runSeoRefreshOffersBatch } from '../_shared/seo-refresh-offers-run.ts';

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
  if (!authorizeCronOrServiceRole(req)) {
    return jsonResponse({ ok: false, error: 'Unauthorized' }, 401);
  }

  try {
    let body: Record<string, unknown> = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const supabase = serviceClient();
    const result = await runSeoRefreshOffersBatch(supabase, {
      limit: body.limit as number | undefined,
      offset: body.offset as number | undefined,
      slug: typeof body.slug === 'string' ? body.slug : undefined,
      productKey:
        typeof body.product_key === 'string'
          ? body.product_key
          : typeof body.productKey === 'string'
            ? body.productKey
            : undefined,
    });

    console.info(
      '[seo-refresh-offers]',
      `scanned=${result.scanned}`,
      `updated=${result.updated}`,
      `unchanged=${result.unchanged}`,
      `errors=${result.errors}`,
    );

    return jsonResponse(result, result.ok ? 200 : 500);
  } catch (error) {
    console.error('[seo-refresh-offers]', error);
    return jsonResponse({
      ok: false,
      error: error instanceof Error ? error.message : 'Server error',
    }, 500);
  }
});
