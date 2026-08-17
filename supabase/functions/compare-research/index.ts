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
import {
  scoreTitle,
  searchOzon,
  searchWb,
  searchYm,
  type Marketplace,
  type SearchCandidate,
} from '../_shared/marketplace-search-core.ts';

const VALID: Marketplace[] = ['wildberries', 'ozon', 'yandex_market'];
const SERVER_VERIFY_MIN_CONFIDENCE = 70;

interface Candidate extends SearchCandidate {
  serverVerified?: boolean;
  serverMatchConfidence?: number;
  serverTitle?: string;
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
