/**
 * Сборка MarketplaceOffer из ranked SERP-кандидатов (API / in-tab / DOM).
 * SERP never declares found:true — only a candidate pool for card cascade.
 */
import type {
  ComparisonMarketplace,
  MarketplaceOffer,
  SearchCandidateOffer,
} from '@/types/comparison';
import { MAX_CANDIDATE_POOL } from '@/lib/candidate-pool';
import { normalizeMarketplaceRating } from '@/lib/compare-offers';
import {
  hasLargePriceSpreadAmongClose,
  pickCheapestAmongCloseMatches,
} from '@/lib/match-status';
import { isProductPageUrl } from '@/lib/product-match';
import { isTitleCategoryCompatible } from '@/lib/match-category';
import { sanitizeCandidateTitle } from '@/lib/serp-title';

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
    matchStatus: 'not_found',
    error: error ?? 'Товар не найден',
  };
}

/** Собрать Top-N pool из ranked API/DOM кандидатов — успех только после card cascade */
export function buildOfferFromRankedCandidates(
  marketplace: ComparisonMarketplace,
  query: string,
  searchUrl: string,
  ranked: Array<{ offer: MarketplaceOffer; confidence: number }>,
  referenceTitle?: string,
): MarketplaceOffer {
  if (!ranked.length) {
    return notFoundOffer(marketplace, query, searchUrl, 'Подходящий товар не найден в выдаче');
  }

  const refTitle =
    referenceTitle && referenceTitle.trim() && referenceTitle !== 'Товар'
      ? referenceTitle
      : query;

  const categoryFiltered = ranked.filter((r) =>
    isTitleCategoryCompatible(refTitle, r.offer.title ?? ''),
  );
  if (!categoryFiltered.length) {
    return notFoundOffer(
      marketplace,
      query,
      searchUrl,
      'В выдаче нет товаров той же категории',
    );
  }

  const withPrice = categoryFiltered.map((r) => ({
    ...r,
    confidence: r.confidence,
    price: r.offer.price,
  }));
  const reordered = pickCheapestAmongCloseMatches(withPrice);
  const forceChoice = hasLargePriceSpreadAmongClose(reordered);

  const searchCandidates: SearchCandidateOffer[] = reordered
    .slice(0, MAX_CANDIDATE_POOL)
    .filter((r) => r.offer.url && isProductPageUrl(r.offer.url))
    .map((r, i) => ({
      title: sanitizeCandidateTitle(r.offer.title, undefined, r.offer.url),
      url: r.offer.url,
      price: r.offer.price,
      matchConfidence: r.confidence,
      priority: 100 - i,
      imageUrl: r.offer.imageUrl,
      rating: normalizeMarketplaceRating(r.offer.rating),
    }));

  if (!searchCandidates.length) {
    return notFoundOffer(
      marketplace,
      query,
      searchUrl,
      'В выдаче нет ссылок на карточки товаров',
    );
  }

  const best = searchCandidates[0]!;
  const shellUrl = searchUrl;
  const shellRating =
    searchCandidates.length === 1 ? normalizeMarketplaceRating(best.rating) : null;

  return {
    marketplace,
    title: best.title,
    price: null,
    delivery: null,
    rating: shellRating,
    reviewCount: undefined,
    url: shellUrl,
    found: false,
    matchConfidence: best.matchConfidence,
    matchStatus: 'needs_choice',
    searchCandidates,
    needsManualPick: true,
    error:
      searchCandidates.length > 1
        ? forceChoice
          ? `Цены сильно отличаются — выберите нужный из ${searchCandidates.length}`
          : `Есть ${searchCandidates.length} похожих варианта — проверяем карточки`
        : 'Проверяем карточку товара',
  };
}
