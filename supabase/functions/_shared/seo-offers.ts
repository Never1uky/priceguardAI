/**
 * Load cross-MP offers + source price for SEO snapshots (no AI, no live scrape storms).
 * Source marketplace is always included first when price/url exist.
 */

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import {
  productIdLookupCandidates,
  stripProductIdPrefix,
} from './product-id.ts';
import type { Marketplace } from './product-url.ts';
import {
  mergeSeoOffers,
  SEO_MAX_OFFERS,
  type SeoOfferSnapshot,
} from './seo-publish-core.ts';
import { seoOffersIds } from './seo-marketplaces.ts';

const OTHER_MPS = seoOffersIds() as Marketplace[];
export { SEO_MAX_OFFERS, mergeSeoOffers };
const MAX_MAPPINGS_PER_MP = 3;

export async function loadSourcePrice(
  supabase: SupabaseClient,
  marketplace: Marketplace,
  productId: string,
): Promise<{ price: number | null; url: string | null; title?: string | null }> {
  const candidates = productIdLookupCandidates(marketplace, productId);
  for (const id of candidates) {
    const { data } = await supabase
      .from('price_scrape_cache')
      .select('price, url, title')
      .eq('marketplace', marketplace)
      .eq('product_id', id)
      .maybeSingle();
    if (data && data.price != null && Number(data.price) > 0) {
      return {
        price: Number(data.price),
        url: data.url ? String(data.url) : null,
        title: data.title ? String(data.title) : null,
      };
    }
    if (data?.url) {
      return {
        price: data.price != null ? Number(data.price) : null,
        url: String(data.url),
        title: data.title ? String(data.title) : null,
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

  const source = await loadSourcePrice(supabase, marketplace, bare);
  // Only keep source offer when we have a real price (url-only rows wipe SEO tables).
  if (source.price != null && source.price > 0) {
    offers.push({
      marketplace,
      productId: bare,
      url: source.url || '',
      title: source.title ?? undefined,
      price: source.price,
    });
  }

  for (const target of OTHER_MPS) {
    if (target === marketplace) continue;
    if (offers.length >= SEO_MAX_OFFERS) break;

    const mappings: Array<{ target_product_id: string; target_url: string }> = [];
    for (const sourceId of idCandidates) {
      const { data } = await supabase
        .from('cross_market_mapping')
        .select('target_product_id, target_url, rank')
        .eq('source_marketplace', marketplace)
        .eq('source_product_id', sourceId)
        .eq('target_marketplace', target)
        .eq('status', 'active')
        .order('rank', { ascending: true })
        .limit(MAX_MAPPINGS_PER_MP);
      if (data?.length) {
        for (const row of data) {
          if (!row?.target_product_id) continue;
          mappings.push({
            target_product_id: String(row.target_product_id),
            target_url: String(row.target_url || ''),
          });
        }
        break;
      }
    }

    for (const mapping of mappings) {
      if (offers.length >= SEO_MAX_OFFERS) break;
      const targetBare = stripProductIdPrefix(target, mapping.target_product_id);
      if (offers.some((o) => o.marketplace === target && o.productId === targetBare)) {
        continue;
      }
      const targetCandidates = productIdLookupCandidates(target, targetBare);
      let price: number | null = null;
      let url = mapping.target_url;
      let title: string | undefined;
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
          if (data.title) title = String(data.title);
          break;
        }
        if (data?.url && !url) url = String(data.url);
      }
      // Prefer priced offers only; url-without-price pollutes SEO tables.
      if (!(price != null && price > 0)) {
        continue;
      }
      offers.push({
        marketplace: target,
        productId: targetBare,
        url,
        title,
        price,
      });
    }
  }

  return mergeSeoOffers(offers);
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
