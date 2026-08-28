/**
 * Unambiguous SERP top-1 → verified product URL without waiting for card cascade.
 * Ties / mixed models stay needs_choice for cascade or picker.
 */
import type { ComparisonMarketplace, MarketplaceOffer } from '@/types/comparison';
import {
  hasLargePriceSpreadAmongClose,
  resolveMatchStatus,
} from '@/lib/match-status';
import {
  AUTO_PICK_CONFIDENCE_THRESHOLD,
  isAliMegaMarketplace,
  isAliMegaSerpPriceOutlier,
  isCloseMatchTie,
  isProductPageUrl,
} from '@/lib/product-match';
import { normalizeMarketplaceRating } from '@/lib/compare-offers';

export interface SerpAutoPickCandidate {
  title: string;
  url: string;
  price: number | null;
  confidence: number;
  imageUrl?: string;
  rating?: number | null;
}

export function isUnambiguousSerpTop(ranked: SerpAutoPickCandidate[]): boolean {
  if (!ranked.length) return false;
  const best = ranked[0]!;
  if (best.confidence < AUTO_PICK_CONFIDENCE_THRESHOLD) return false;
  if (!best.url || !isProductPageUrl(best.url)) return false;
  if (best.price == null || best.price <= 0) return false;
  if (hasLargePriceSpreadAmongClose(ranked)) return false;
  const second = ranked[1];
  if (second && isCloseMatchTie(best.confidence, second.confidence)) return false;
  return true;
}

export function serpVerifiedFromCandidate(
  marketplace: ComparisonMarketplace,
  candidate: SerpAutoPickCandidate,
): MarketplaceOffer {
  return {
    marketplace,
    title: candidate.title,
    price: candidate.price,
    delivery: null,
    rating: normalizeMarketplaceRating(candidate.rating),
    url: candidate.url,
    imageUrl: candidate.imageUrl,
    found: true,
    matchConfidence: candidate.confidence,
    matchStatus: resolveMatchStatus({
      found: true,
      matchConfidence: candidate.confidence,
      alternativeCount: 0,
    }),
    needsManualPick: false,
    error: undefined,
  };
}

/** Clear top-1 with product URL + price → verified; otherwise null (caller keeps picker / cascade). */
export function tryUnambiguousSerpVerified(
  marketplace: ComparisonMarketplace,
  ranked: SerpAutoPickCandidate[],
  opts?: { referencePrice?: number },
): MarketplaceOffer | null {
  if (!isUnambiguousSerpTop(ranked)) return null;
  const best = ranked[0]!;
  // Null price already blocked above; Ali/Mega also reject SERP price outliers vs source.
  if (
    isAliMegaMarketplace(marketplace) &&
    isAliMegaSerpPriceOutlier(opts?.referencePrice, best.price)
  ) {
    return null;
  }
  return serpVerifiedFromCandidate(marketplace, best);
}
