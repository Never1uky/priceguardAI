/**
 * Server-side compare research (JWT): search target marketplaces without HiddenBrowser.
 * POST { title, sourceMarketplace, referencePrice?, sourceUrl?, targetMarketplaces? }
 * → { ok, results: { marketplace, candidates: [...] }[] }
 *
 * Scrappey top-1 verify: Premium only for CORE. Mega/Ali: OFF (card unlocker only, not research verify).
 * Targets: VALID (trio + megamarket + aliexpress) ∩ client targetMarketplaces (fallback = VALID \ source).
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { requireAuthUser } from '../_shared/auth.ts';
import { corsHeaders, jsonResponse } from '../_shared/utils.ts';
import {
  extractAliExpressProductId,
  extractMegamarketProductId,
  fetchMarketplacePriceDetailed,
} from '../_shared/marketplace-prices.ts';
import { projectScraperCredentials } from '../_shared/reviews-common.ts';
import { extractProductId } from '../_shared/product-url.ts';
import { resolveUserPlanAccess } from '../_shared/premium-active.ts';
import {
  COMPARE_RESEARCH_VALID,
  MARKETPLACE_SEARCHERS,
  matchConfidenceForMarketplace,
  resolveCompareResearchTargets,
  type Marketplace,
  type SearchCandidate,
} from '../_shared/marketplace-search-core.ts';

const VALID = COMPARE_RESEARCH_VALID;
const SERVER_VERIFY_MIN_CONFIDENCE = 70;

/**
 * MEGA-3 / ALI-3 approved = card unlocker only. Research Scrappey verify for Mega/Ali stays OFF
 * (tab-or-available SERP; client HiddenBrowser / card unlocker handle priced cards).
 * Set true only after an explicit cost RFC for research verify.
 */
const MEGA_RESEARCH_SCRAPPEY_VERIFY = false;
const ALI_RESEARCH_SCRAPPEY_VERIFY = false;

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

async function userHasPremium(userId: string): Promise<boolean> {
  const plan = await resolveUserPlanAccess(serviceClient(), userId);
  return plan.premiumTier;
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

function productIdForVerify(mp: Marketplace, url: string): string {
  if (mp === 'megamarket') return extractMegamarketProductId(url);
  if (mp === 'aliexpress') return extractAliExpressProductId(url);
  return extractProductId(url, mp);
}

async function verifyTopCandidate(
  mp: Marketplace,
  candidate: Candidate,
  referenceTitle: string,
  referencePrice: number | undefined,
  allowScrappey: boolean,
): Promise<Candidate> {
  if (mp === 'megamarket' && !MEGA_RESEARCH_SCRAPPEY_VERIFY) {
    return { ...candidate, serverVerified: false };
  }
  if (mp === 'aliexpress' && !ALI_RESEARCH_SCRAPPEY_VERIFY) {
    return { ...candidate, serverVerified: false };
  }

  const scraper = allowScrappey ? projectScraperCredentials() : null;
  // Ozon/YM/(optional Mega/Ali) need Scrappey; without it (or Free) skip verify.
  // WB card.wb.ru works without Scrappey.
  if (!scraper && mp !== 'wildberries') {
    return { ...candidate, serverVerified: false };
  }
  if (!allowScrappey && mp !== 'wildberries') {
    return { ...candidate, serverVerified: false };
  }

  const productId = productIdForVerify(mp, candidate.url);
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
    const serverMatchConfidence = matchConfidenceForMarketplace(
      mp,
      referenceTitle,
      serverTitle || candidate.title,
    );
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
    const user = await requireAuthUser(req, true);
    const body = await req.json();
    const title = String(body.title ?? '').trim();
    const sourceMarketplace = String(body.sourceMarketplace ?? '') as Marketplace;
    const referencePrice = body.referencePrice != null ? Number(body.referencePrice) : undefined;

    if (!title || !VALID.includes(sourceMarketplace)) {
      return jsonResponse(
        { ok: false, error: 'title и sourceMarketplace обязательны', code: 'BAD_REQUEST' },
        400,
      );
    }

    const premium = user?.id ? await userHasPremium(user.id) : false;
    const targets = resolveCompareResearchTargets(sourceMarketplace, body.targetMarketplaces);
    const results: Array<{ marketplace: Marketplace; candidates: Candidate[] }> = [];

    for (const mp of targets) {
      let candidates: Candidate[] = [];
      try {
        const searcher = MARKETPLACE_SEARCHERS[mp];
        candidates = await searcher(title, title);
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
      // Mega/Ali: drop residual junk after sort (identity gate already in searcher)
      if (mp === 'megamarket' || mp === 'aliexpress') {
        candidates = candidates.filter((c) => c.matchConfidence > 0);
      }
      const top = candidates.slice(0, 5);
      if (top[0]) {
        top[0] = await verifyTopCandidate(mp, top[0], title, referencePrice, premium);
      }
      results.push({ marketplace: mp, candidates: top });
    }

    return jsonResponse({ ok: true, results, premiumVerify: premium });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg === 'auth_required' || msg === 'invalid_token') {
      return jsonResponse({ ok: false, error: 'Требуется авторизация' }, 401);
    }
    console.error('[compare-research]', error);
    return jsonResponse({ ok: false, error: 'Server error' }, 500);
  }
});
