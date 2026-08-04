/**
 * Client wrapper for Edge compare-research (server SERP without HiddenBrowser).
 */
import { callEdgeSafe } from '@/lib/supabase/edge';
import { canUseCloudFeatures } from '@/lib/supabase/auth-guard';
import { getSupabaseConfig } from '@/lib/supabase/config';
import type { ComparisonMarketplace, MarketplaceOffer } from '@/types/comparison';
import { buildMarketplaceSearchUrl } from '@/utils/comparison-url';
import { buildOfferFromRankedCandidates } from '@/lib/search-offer-from-candidates';

interface EdgeCandidate {
  title: string;
  url: string;
  price: number | null;
  matchConfidence: number;
  imageUrl?: string;
}

interface EdgeResult {
  marketplace: ComparisonMarketplace;
  candidates: EdgeCandidate[];
}

export async function researchCompareViaEdge(input: {
  title: string;
  sourceMarketplace: ComparisonMarketplace;
  referencePrice?: number;
  sourceUrl?: string;
}): Promise<Partial<Record<ComparisonMarketplace, MarketplaceOffer>> | null> {
  if (!getSupabaseConfig().configured) return null;
  if (!(await canUseCloudFeatures())) return null;

  const res = await callEdgeSafe<{ ok?: boolean; results?: EdgeResult[] }>('compare-research', {
    title: input.title,
    sourceMarketplace: input.sourceMarketplace,
    referencePrice: input.referencePrice,
    sourceUrl: input.sourceUrl,
  });

  if (!res?.ok || !Array.isArray(res.results)) return null;

  const out: Partial<Record<ComparisonMarketplace, MarketplaceOffer>> = {};
  for (const row of res.results) {
    if (!row.candidates?.length) continue;
    const searchUrl = buildMarketplaceSearchUrl(row.marketplace, input.title);
    const ranked = row.candidates.map((c) => ({
      offer: {
        marketplace: row.marketplace,
        title: c.title,
        price: c.price,
        delivery: null,
        rating: null,
        url: c.url,
        imageUrl: c.imageUrl,
        found: Boolean(c.price && c.price > 0),
      } satisfies MarketplaceOffer,
      confidence: c.matchConfidence,
    }));
    out[row.marketplace] = buildOfferFromRankedCandidates(
      row.marketplace,
      input.title,
      searchUrl,
      ranked,
    );
  }

  return Object.keys(out).length ? out : null;
}
