/**
 * Publish / refresh durable SEO pages from product_cache v2.
 * Auth: x-cron-secret or Bearer service_role.
 * Never calls ai-proxy / generate.
 *
 * POST JSON: { marketplace, productId } | { product_key: "ozon:123" }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { corsHeaders, jsonResponse } from '../_shared/utils.ts';
import { authorizeCronOrServiceRole } from '../_shared/cron-auth.ts';
import { parseProductKey } from '../_shared/product-id.ts';
import type { Marketplace } from '../_shared/product-url.ts';
import { backfillSeoCategories, batchPublishFromCacheV2, collectSeoPublishMetrics, runSeoPublish } from '../_shared/seo-publish-run.ts';

const MARKETPLACES = new Set(['wildberries', 'ozon', 'yandex_market']);

function serviceClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
}

function isMarketplace(v: string): v is Marketplace {
  return MARKETPLACES.has(v);
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

    if (body.action === 'backfill-categories') {
      const limit = Number(body.limit ?? 100);
      const supabase = serviceClient();
      const result = await backfillSeoCategories(
        supabase,
        Number.isFinite(limit) ? limit : 100,
      );
      console.info('[seo-publish] backfill-categories', result);
      return jsonResponse(result);
    }

    if (body.action === 'batch-publish') {
      const supabase = serviceClient();
      const result = await batchPublishFromCacheV2(supabase, {
        limit: Number(body.limit ?? 25),
        offset: Number(body.offset ?? 0),
        featuredOnly: Boolean(body.featuredOnly),
      });
      console.info('[seo-publish] batch-publish', result);
      return jsonResponse(result);
    }

    if (body.action === 'metrics') {
      const supabase = serviceClient();
      const result = await collectSeoPublishMetrics(supabase);
      console.info('[seo-publish] metrics', result);
      return jsonResponse(result);
    }

    let marketplace: Marketplace | null = null;
    let productId: string | null = null;

    if (typeof body.product_key === 'string') {
      const parsed = parseProductKey(body.product_key);
      if (parsed) {
        marketplace = parsed.marketplace;
        productId = parsed.productId;
      }
    }
    if (
      !marketplace &&
      typeof body.marketplace === 'string' &&
      typeof body.productId === 'string' &&
      isMarketplace(body.marketplace)
    ) {
      marketplace = body.marketplace;
      productId = body.productId;
    }
    if (
      !marketplace &&
      typeof body.marketplace === 'string' &&
      typeof body.product_id === 'string' &&
      isMarketplace(body.marketplace)
    ) {
      marketplace = body.marketplace;
      productId = body.product_id;
    }

    if (!marketplace || !productId) {
      return jsonResponse({
        ok: false,
        error: 'Expected { marketplace, productId } or { product_key }',
      }, 400);
    }

    const supabase = serviceClient();
    const result = await runSeoPublish(supabase, marketplace, productId);
    const id = `${marketplace}:${productId}`;
    if (result.skipped === 'unchanged' || result.skipped === 'missing_cache') {
      console.info('[seo-publish] skipped', result.skipped, id, result.slug ?? '');
    } else if (result.skipped === 'rejected') {
      console.info('[seo-publish] rejected', result.rejectReason ?? '', id, result.slug ?? '');
    } else if (result.ok && result.published) {
      console.info('[seo-publish] ok', id, result.slug ?? '');
    }
    return jsonResponse(result, result.ok ? 200 : 500);
  } catch (error) {
    console.error('[seo-publish]', error);
    return jsonResponse({
      ok: false,
      error: error instanceof Error ? error.message : 'Server error',
    }, 500);
  }
});
