/**
 * Сборка MarketplaceOffer из ranked SERP-кандидатов (API / in-tab / DOM).
 */
import type {
  ComparisonMarketplace,
  MarketplaceOffer,
  SearchCandidateOffer,
} from '@/types/comparison';
import { MAX_CANDIDATE_POOL } from '@/lib/candidate-pool';
import { normalizeMarketplaceRating } from '@/lib/compare-offers';
import { decideMatchOutcome, resolveMatchStatus } from '@/lib/match-status';
import { computeMatchConfidence } from '@/lib/product-match';

function notFoundOffer(
  marketplace: ComparisonMarketplace,
  query: string,
  searchUrl: string,
  error?: string,
): MarketplaceOffer {
  return {
    marketplace,
    title: query,
    price: null,
    delivery: null,
    rating: null,
    url: searchUrl,
    found: false,
    error: error ?? 'Товар не найден',
  };
}

function withMatchConfidence(offer: MarketplaceOffer, referenceTitle: string): MarketplaceOffer {
  if (!offer.title || !referenceTitle || referenceTitle === 'Товар') return offer;
  return {
    ...offer,
    matchConfidence: computeMatchConfidence(referenceTitle, offer.title),
  };
}

/** Собрать Top-N offer из ranked API/DOM кандидатов */
export function buildOfferFromRankedCandidates(
  marketplace: ComparisonMarketplace,
  query: string,
  searchUrl: string,
  ranked: Array<{ offer: MarketplaceOffer; confidence: number }>,
): MarketplaceOffer {
  if (!ranked.length) {
    return notFoundOffer(marketplace, query, searchUrl, 'Подходящий товар не найден в выдаче');
  }

  const searchCandidates: SearchCandidateOffer[] = ranked
    .slice(0, MAX_CANDIDATE_POOL)
    .map((r, i) => ({
      title: r.offer.title,
      url: r.offer.url,
      price: r.offer.price,
      matchConfidence: r.confidence,
      priority: 100 - i,
      imageUrl: r.offer.imageUrl,
      rating: normalizeMarketplaceRating(r.offer.rating),
    }));

  const best = ranked[0]!;
  const second = ranked[1];
  const decision = decideMatchOutcome({
    bestMatch: best.confidence,
    secondMatch: second?.confidence,
    alternativeCount: searchCandidates.length,
  });

  if (decision.needsChoice || !decision.autoPick) {
    return {
      marketplace,
      title: best.offer.title,
      price: null,
      delivery: null,
      rating: null,
      reviewCount: undefined,
      url: searchUrl,
      found: false,
      matchConfidence: best.confidence,
      matchStatus: 'needs_choice',
      searchCandidates,
      needsManualPick: true,
      error:
        searchCandidates.length > 1
          ? `Есть ${searchCandidates.length} похожих варианта — выберите нужный`
          : 'Требуется выбор товара',
    };
  }

  const alternatives = searchCandidates.filter((c) => c.url !== best.offer.url);
  return withMatchConfidence(
    {
      ...best.offer,
      rating: normalizeMarketplaceRating(best.offer.rating),
      matchConfidence: best.confidence,
      matchStatus: resolveMatchStatus({
        found: true,
        matchConfidence: best.confidence,
        alternativeCount: alternatives.length,
      }),
      searchCandidates: alternatives.length ? alternatives : undefined,
      needsManualPick: false,
      found: true,
    },
    best.offer.title,
  );
}
