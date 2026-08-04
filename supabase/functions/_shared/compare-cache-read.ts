/**
 * Cache-first cross-MP prices for Telegram bot (no SERP / compare-research).
 * 1) compare_products.payload  2) cross_market_mapping + price_scrape_cache
 */

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { escapeHtml, formatRub, marketplaceLabel } from './telegram.ts';
import {
  productIdLookupCandidates,
  stripProductIdPrefix,
  toPrefixedProductId,
} from './product-id.ts';
import type { Marketplace } from './product-url.ts';

export type CachedCompareOffer = {
  marketplace: Marketplace;
  productId: string;
  url: string;
  price: number | null;
  title?: string;
  isSource?: boolean;
};

function asMp(raw: unknown): Marketplace | null {
  const s = String(raw ?? '');
  if (s === 'wildberries' || s === 'ozon' || s === 'yandex_market') return s;
  return null;
}

function offerPrice(raw: unknown): number | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const n = Number(o.price);
  return n > 0 ? n : null;
}

/** Read user's compare_products snapshot if it matches this SKU. */
export async function loadCompareOffersFromUserPayload(
  supabase: SupabaseClient,
  params: {
    userId: string;
    marketplace: Marketplace;
    productId: string;
  },
): Promise<CachedCompareOffer[]> {
  const bare = stripProductIdPrefix(params.marketplace, params.productId);
  const prefixed = toPrefixedProductId(params.marketplace, bare);
  const candidates = [
    ...productIdLookupCandidates(params.marketplace, bare),
    prefixed,
    bare,
  ];

  const { data: rows } = await supabase
    .from('compare_products')
    .select('product_id, payload')
    .eq('user_id', params.userId)
    .limit(40);

  if (!rows?.length) return [];

  const match = rows.find((r) => {
    const pid = String(r.product_id ?? '');
    if (candidates.some((c) => pid === c || pid.endsWith(c) || c.endsWith(pid))) {
      return true;
    }
    const p = r.payload as Record<string, unknown> | null;
    if (!p) return false;
    const src = p.sourceOffer as Record<string, unknown> | undefined;
    const srcMp = asMp(src?.marketplace);
    const srcId = String(src?.productId ?? src?.id ?? '');
    if (srcMp === params.marketplace && candidates.some((c) => srcId === c || srcId.includes(bare))) {
      return true;
    }
    return false;
  });

  if (!match?.payload || typeof match.payload !== 'object') return [];
  const payload = match.payload as Record<string, unknown>;
  const out: CachedCompareOffer[] = [];

  const source = payload.sourceOffer as Record<string, unknown> | undefined;
  if (source) {
    const mp = asMp(source.marketplace) ?? params.marketplace;
    out.push({
      marketplace: mp,
      productId: String(source.productId ?? bare),
      url: String(source.url ?? ''),
      price: offerPrice(source),
      title: source.title ? String(source.title) : undefined,
      isSource: true,
    });
  }

  const offers = payload.marketplaceOffers;
  if (offers && typeof offers === 'object') {
    for (const [mpKey, val] of Object.entries(offers as Record<string, unknown>)) {
      const mp = asMp(mpKey);
      if (!mp || !val || typeof val !== 'object') continue;
      const o = val as Record<string, unknown>;
      out.push({
        marketplace: mp,
        productId: String(o.productId ?? o.id ?? ''),
        url: String(o.url ?? ''),
        price: offerPrice(o),
        title: o.title ? String(o.title) : undefined,
      });
    }
  }

  return out.filter((o) => o.price != null && o.price > 0);
}

/** Mapping edges + price_scrape_cache only (no live scrape). */
export async function loadCompareOffersFromMappingCache(
  supabase: SupabaseClient,
  params: {
    marketplace: Marketplace;
    productId: string;
    sourceUrl?: string | null;
    sourcePrice?: number | null;
    sourceTitle?: string | null;
  },
): Promise<CachedCompareOffer[]> {
  const bare = stripProductIdPrefix(params.marketplace, params.productId);
  const out: CachedCompareOffer[] = [];

  if (params.sourcePrice != null && params.sourcePrice > 0) {
    out.push({
      marketplace: params.marketplace,
      productId: bare,
      url: params.sourceUrl ?? '',
      price: params.sourcePrice,
      title: params.sourceTitle ?? undefined,
      isSource: true,
    });
  }

  const lookupIds = productIdLookupCandidates(params.marketplace, bare);
  const { data: edges } = await supabase
    .from('cross_market_mapping')
    .select('target_marketplace, target_product_id, target_url, rank, status')
    .eq('source_marketplace', params.marketplace)
    .in('source_product_id', lookupIds)
    .eq('status', 'active')
    .order('rank', { ascending: true })
    .limit(6);

  for (const edge of edges ?? []) {
    const mp = asMp(edge.target_marketplace);
    if (!mp) continue;
    const tid = String(edge.target_product_id ?? '');
    const url = String(edge.target_url ?? '');
    const { data: cached } = await supabase
      .from('price_scrape_cache')
      .select('price, title, url')
      .eq('marketplace', mp)
      .eq('product_id', stripProductIdPrefix(mp, tid))
      .maybeSingle();

    const price = cached?.price != null ? Number(cached.price) : null;
    if (price == null || !(price > 0)) continue;
    out.push({
      marketplace: mp,
      productId: tid,
      url: url || String(cached?.url ?? ''),
      price,
      title: cached?.title ? String(cached.title) : undefined,
    });
  }

  return out;
}

export async function resolveCachedCompareOffers(
  supabase: SupabaseClient,
  params: {
    userId: string | null;
    marketplace: Marketplace;
    productId: string;
    sourceUrl?: string | null;
    sourcePrice?: number | null;
    sourceTitle?: string | null;
  },
): Promise<{ offers: CachedCompareOffer[]; source: 'compare_products' | 'mapping_cache' | 'empty' }> {
  if (params.userId) {
    const fromUser = await loadCompareOffersFromUserPayload(supabase, {
      userId: params.userId,
      marketplace: params.marketplace,
      productId: params.productId,
    });
    if (fromUser.length >= 2) {
      return { offers: fromUser, source: 'compare_products' };
    }
  }

  const fromMap = await loadCompareOffersFromMappingCache(supabase, params);
  if (fromMap.length >= 1) {
    return { offers: fromMap, source: 'mapping_cache' };
  }
  return { offers: [], source: 'empty' };
}

export function renderCachedCompareMessage(input: {
  title: string;
  offers: CachedCompareOffer[];
  dataSource: 'compare_products' | 'mapping_cache' | 'empty';
}): string {
  if (input.offers.length === 0) {
    return [
      '📊 <b>Сравнение цен</b>',
      '',
      `🛍 ${escapeHtml(input.title.slice(0, 100))}`,
      '',
      'Нет сохранённых цен по другим площадкам.',
      'Откройте товар в расширении → вкладка «Цены», затем повторите.',
    ].join('\n');
  }

  const priced = [...input.offers].filter((o) => o.price != null && o.price > 0);
  priced.sort((a, b) => (a.price! - b.price!));
  const best = priced[0];

  const lines = [
    '📊 <b>Сравнение цен</b>',
    '',
    `🛍 <b>${escapeHtml(input.title.slice(0, 100))}</b>`,
    '',
  ];

  for (const o of priced) {
    const mark = best && o.marketplace === best.marketplace && o.price === best.price ? ' ✅' : '';
    const src = o.isSource ? ' (эта карточка)' : '';
    lines.push(
      `• ${escapeHtml(marketplaceLabel(o.marketplace))}: <b>${formatRub(o.price!)}</b>${src}${mark}`,
    );
  }

  if (best) {
    lines.push(
      '',
      `💰 Самая выгодная: <b>${escapeHtml(marketplaceLabel(best.marketplace))}</b>`,
    );
  }

  if (input.dataSource === 'mapping_cache') {
    lines.push('', '<i>Из кэша сопоставлений · без нового поиска</i>');
  } else if (input.dataSource === 'compare_products') {
    lines.push('', '<i>Из вашего сравнения в расширении</i>');
  }

  return lines.join('\n');
}

export function compareResultKeyboard(input: {
  bestUrl?: string | null;
  ref: string;
  alreadyTracked?: boolean;
}): Array<Array<{ text: string; callback_data: string } | { text: string; url: string }>> {
  const rows: Array<Array<{ text: string; callback_data: string } | { text: string; url: string }>> =
    [];
  const top: Array<{ text: string; callback_data: string } | { text: string; url: string }> = [];
  if (input.bestUrl?.startsWith('http')) {
    top.push({ text: '📂 Открыть дешевле', url: input.bestUrl });
  }
  if (!input.alreadyTracked) {
    top.push({ text: '🔔 Следить', callback_data: `pi:watch:${input.ref}` });
  }
  top.push({ text: '🤖 Анализ', callback_data: `st:ai:${input.ref}` });
  if (top.length) rows.push(top);
  return rows;
}
