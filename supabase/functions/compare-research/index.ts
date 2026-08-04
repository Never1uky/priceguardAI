/**
 * Server-side compare research (JWT): search target marketplaces without HiddenBrowser.
 * POST { title, sourceMarketplace, referencePrice?, sourceUrl? }
 * → { ok, results: { marketplace, candidates: [{title,url,price,matchConfidence,serverVerified?...}] }[] }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { requireAuthUser } from '../_shared/auth.ts';
import { corsHeaders, jsonResponse } from '../_shared/utils.ts';
import { fetchMarketplacePriceDetailed } from '../_shared/marketplace-prices.ts';
import { projectScraperCredentials } from '../_shared/reviews-common.ts';
import { extractProductId } from '../_shared/product-url.ts';

type Marketplace = 'wildberries' | 'ozon' | 'yandex_market';

const VALID: Marketplace[] = ['wildberries', 'ozon', 'yandex_market'];
const SERVER_VERIFY_MIN_CONFIDENCE = 70;

interface Candidate {
  title: string;
  url: string;
  price: number | null;
  matchConfidence: number;
  imageUrl?: string;
  serverVerified?: boolean;
  serverMatchConfidence?: number;
  serverTitle?: string;
}

function scoreTitle(ref: string, cand: string): number {
  const a = ref.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
  const b = new Set(cand.toLowerCase().split(/\s+/).filter((t) => t.length > 2));
  if (!a.length) return 50;
  let hit = 0;
  for (const t of a) if (b.has(t)) hit += 1;
  return Math.round((hit / a.length) * 100);
}

function serviceClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
}

function priceSanityOk(
  referencePrice: number | undefined,
  cardPrice: number | null | undefined,
): boolean {
  if (referencePrice == null || referencePrice <= 0 || !cardPrice || cardPrice <= 0) {
    return true;
  }
  const ratio = cardPrice / referencePrice;
  return ratio >= 0.35 && ratio <= 2.8;
}

async function verifyTopCandidate(
  mp: Marketplace,
  candidate: Candidate,
  referenceTitle: string,
  referencePrice?: number,
): Promise<Candidate> {
  const scraper = projectScraperCredentials();
  // Ozon/YM need Scrappey; without it skip verify (additive fields stay false).
  // WB card.wb.ru works without Scrappey.
  if (!scraper && mp !== 'wildberries') {
    return { ...candidate, serverVerified: false };
  }
  const productId = extractProductId(candidate.url, mp);
  if (!productId) {
    return { ...candidate, serverVerified: false };
  }

  try {
    const supabase = serviceClient();
    const fetched = await fetchMarketplacePriceDetailed(mp, productId, candidate.url, {
      supabase,
      scraper: scraper ?? undefined,
    });
    if (!fetched?.price || fetched.price <= 0) {
      return { ...candidate, serverVerified: false };
    }

    const serverTitle = (fetched.title || candidate.title || '').trim();
    const serverMatchConfidence = scoreTitle(referenceTitle, serverTitle || candidate.title);
    const sanity = priceSanityOk(referencePrice, fetched.price);
    const serverVerified =
      serverMatchConfidence >= SERVER_VERIFY_MIN_CONFIDENCE && sanity;

    return {
      ...candidate,
      price: fetched.price ?? candidate.price,
      title: serverTitle || candidate.title,
      serverVerified,
      serverMatchConfidence,
      serverTitle: serverTitle || undefined,
    };
  } catch (error) {
    console.warn('[compare-research] top-1 verify', mp, error);
    return { ...candidate, serverVerified: false };
  }
}

async function searchWb(query: string, referenceTitle: string): Promise<Candidate[]> {
  const apiUrl =
    `https://search.wb.ru/exactmatch/ru/common/v5/search` +
    `?appType=1&curr=rub&dest=-1257786&query=${encodeURIComponent(query)}` +
    `&resultset=catalog&sort=popular&spp=30&page=1`;
  const res = await fetch(apiUrl, { headers: { Accept: 'application/json' } });
  if (!res.ok) return [];
  const data = await res.json() as {
    data?: { products?: Array<{ id?: number; name?: string; brand?: string; salePriceU?: number; priceU?: number }> };
  };
  const products = data.data?.products ?? [];
  return products.slice(0, 8).map((p) => {
    const title = [p.brand, p.name].filter(Boolean).join(' ') || query;
    const sale = p.salePriceU ? Math.round(p.salePriceU / 100) : null;
    const basic = p.priceU ? Math.round(p.priceU / 100) : null;
    const price = sale || basic;
    return {
      title,
      url: p.id ? `https://www.wildberries.ru/catalog/${p.id}/detail.aspx` : '',
      price,
      matchConfidence: scoreTitle(referenceTitle, title),
    };
  }).filter((c) => c.url);
}

async function searchOzon(query: string, referenceTitle: string): Promise<Candidate[]> {
  const path = `/search/?text=${query}&deny_category_prediction=true`;
  const apiUrl =
    `https://www.ozon.ru/api/composer-api.bx/page/json/v2?url=${encodeURIComponent(path)}`;
  const res = await fetch(apiUrl, {
    headers: { Accept: 'application/json', 'Accept-Language': 'ru-RU,ru;q=0.9' },
  });
  if (!res.ok) return [];
  const data = await res.json() as { widgetStates?: Record<string, string> };
  const out: Candidate[] = [];
  for (const raw of Object.values(data.widgetStates ?? {})) {
    try {
      const parsed = JSON.parse(raw) as {
        items?: Array<{
          mainState?: Array<{ type?: string; atom?: { textAtom?: { text?: string }; priceV2?: { price?: Array<{ text?: string }> } } }>;
          action?: { link?: string };
        }>;
      };
      for (const item of parsed.items ?? []) {
        const link = item.action?.link ?? '';
        if (!link.includes('/product/')) continue;
        let title = query;
        let price: number | null = null;
        for (const st of item.mainState ?? []) {
          const text = st.atom?.textAtom?.text;
          if (text && st.type?.toLowerCase().includes('text')) title = text;
          const priceText = st.atom?.priceV2?.price?.[0]?.text;
          if (priceText) {
            const n = Number(priceText.replace(/[^\d]/g, ''));
            if (n > 0) price = n;
          }
        }
        const url = link.startsWith('http') ? link : `https://www.ozon.ru${link}`;
        out.push({
          title,
          url: url.split('?')[0]!,
          price,
          matchConfidence: scoreTitle(referenceTitle, title),
        });
      }
    } catch {
      // skip widget
    }
  }
  return out.slice(0, 8);
}

async function searchYm(query: string, referenceTitle: string): Promise<Candidate[]> {
  const apiUrl =
    `https://market.yandex.ru/api/resolve/?r=search%2Fsearch` +
    `&text=${encodeURIComponent(query)}&cvredirect=0&how=aprice`;
  try {
    const res = await fetch(apiUrl, {
      headers: { Accept: 'application/json', 'Accept-Language': 'ru-RU' },
    });
    if (!res.ok) return [];
    const data = await res.json();
    const out: Candidate[] = [];
    const walk = (node: unknown): void => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        for (const x of node) walk(x);
        return;
      }
      const obj = node as Record<string, unknown>;
      if (obj.titles && obj.prices) {
        const titles = obj.titles as { raw?: string };
        const prices = obj.prices as { value?: string | number };
        const slug = String(obj.slug ?? '');
        const id = String((obj as { id?: string }).id ?? '');
        const title = titles.raw || query;
        const price = Number(prices.value) || null;
        const url = id
          ? `https://market.yandex.ru/product/${id}`
          : slug
            ? `https://market.yandex.ru/product--${slug}`
            : '';
        if (url) {
          out.push({
            title,
            url,
            price,
            matchConfidence: scoreTitle(referenceTitle, title),
          });
        }
      }
      for (const v of Object.values(obj)) walk(v);
    };
    walk(data);
    return out.slice(0, 8);
  } catch {
    return [];
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Method not allowed' }, 405);
  }

  try {
    await requireAuthUser(req, true);
    const body = await req.json();
    const title = String(body.title ?? '').trim();
    const sourceMarketplace = String(body.sourceMarketplace ?? '') as Marketplace;
    const referencePrice = body.referencePrice != null ? Number(body.referencePrice) : undefined;

    if (!title || !VALID.includes(sourceMarketplace)) {
      return jsonResponse({ ok: false, error: 'title и sourceMarketplace обязательны' }, 400);
    }

    const targets = VALID.filter((m) => m !== sourceMarketplace);
    const results: Array<{ marketplace: Marketplace; candidates: Candidate[] }> = [];

    for (const mp of targets) {
      let candidates: Candidate[] = [];
      try {
        if (mp === 'wildberries') candidates = await searchWb(title, title);
        else if (mp === 'ozon') candidates = await searchOzon(title, title);
        else candidates = await searchYm(title, title);
      } catch (error) {
        console.warn('[compare-research]', mp, error);
      }
      candidates.sort((a, b) => b.matchConfidence - a.matchConfidence);
      if (referencePrice && referencePrice > 0) {
        candidates.sort((a, b) => {
          if (b.matchConfidence !== a.matchConfidence) return b.matchConfidence - a.matchConfidence;
          const pa = a.price ?? Number.POSITIVE_INFINITY;
          const pb = b.price ?? Number.POSITIVE_INFINITY;
          return pa - pb;
        });
      }
      const top = candidates.slice(0, 5);
      if (top[0]) {
        top[0] = await verifyTopCandidate(mp, top[0], title, referencePrice);
      }
      results.push({ marketplace: mp, candidates: top });
    }

    return jsonResponse({ ok: true, results });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg === 'auth_required' || msg === 'invalid_token') {
      return jsonResponse({ ok: false, error: 'Требуется авторизация' }, 401);
    }
    console.error('[compare-research]', error);
    return jsonResponse({ ok: false, error: 'Server error' }, 500);
  }
});
