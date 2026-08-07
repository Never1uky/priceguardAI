/**
 * Load cross-MP offers + source price for SEO snapshots (no AI, no live scrape storms).
 */

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import {
  productIdLookupCandidates,
  stripProductIdPrefix,
} from './product-id.ts';
import type { Marketplace } from './product-url.ts';
import type { SeoOfferSnapshot } from './seo-publish-core.ts';

const OTHER_MPS: Marketplace[] = ['wildberries', 'ozon', 'yandex_market'];
export const SEO_MAX_OFFERS = 6;

export async function loadSourcePrice(
  supabase: SupabaseClient,
  marketplace: Marketplace,
  productId: string,
): Promise<{ price: number | null; url: string | null }> {
  const candidates = productIdLookupCandidates(marketplace, productId);
  for (const id of candidates) {
    const { data } = await supabase
      .from('price_scrape_cache')
      .select('price, url')
      .eq('marketplace', marketplace)
      .eq('product_id', id)
      .maybeSingle();
    if (data && data.price != null && Number(data.price) > 0) {
      return {
        price: Number(data.price),
        url: data.url ? String(data.url) : null,
      };
    }
  }
  return { price: null, url: null };
}

export async function loadOffersSnapshot(
  supabase: SupabaseClient,
  marketplace: Marketplace,
  productId: string,
): Promise<SeoOfferSnapshot[]> {
  const bare = stripProductIdPrefix(marketplace, productId);
  const idCandidates = productIdLookupCandidates(marketplace, bare);
  const offers: SeoOfferSnapshot[] = [];

  for (const target of OTHER_MPS) {
    if (target === marketplace) continue;
    if (offers.length >= SEO_MAX_OFFERS) break;

    let mapping: { target_product_id: string; target_url: string } | null = null;
    for (const sourceId of idCandidates) {
      const { data } = await supabase
        .from('cross_market_mapping')
        .select('target_product_id, target_url, rank')
        .eq('source_marketplace', marketplace)
        .eq('source_product_id', sourceId)
        .eq('target_marketplace', target)
        .eq('status', 'active')
        .order('rank', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (data?.target_product_id) {
        mapping = {
          target_product_id: String(data.target_product_id),
          target_url: String(data.target_url || ''),
        };
        break;
      }
    }
    if (!mapping) continue;

    const targetBare = stripProductIdPrefix(target, mapping.target_product_id);
    const targetCandidates = productIdLookupCandidates(target, targetBare);
    let price: number | null = null;
    let url = mapping.target_url;
    for (const tid of targetCandidates) {
      const { data } = await supabase
        .from('price_scrape_cache')
        .select('price, url, title')
        .eq('marketplace', target)
        .eq('product_id', tid)
        .maybeSingle();
      if (data?.price != null && Number(data.price) > 0) {
        price = Number(data.price);
        if (data.url) url = String(data.url);
        offers.push({
          marketplace: target,
          productId: targetBare,
          url,
          title: data.title ? String(data.title) : undefined,
          price,
        });
        break;
      }
    }
    if (price == null) {
      offers.push({
        marketplace: target,
        productId: targetBare,
        url,
        price: null,
      });
    }
  }

  return offers.slice(0, SEO_MAX_OFFERS);
}

/** Stable compare for offers_snapshot / price changes. */
export function offersFingerprint(
  offers: unknown,
  priceCurrent: number | null | undefined,
  productUrl: string | null | undefined,
): string {
  return JSON.stringify({
    price: priceCurrent ?? null,
    url: productUrl ?? null,
    offers: offers ?? [],
  });
}
