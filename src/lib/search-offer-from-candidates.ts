/**
 * Сборка MarketplaceOffer из ranked SERP-кандидатов (API / in-tab / DOM).
 * Unambiguous top-1 (AUTO_PICK, product URL, no tie) → verified without cascade.
 * Mixed / tied models stay a candidate pool for cascade / picker.
 */
import type {
  ComparisonMarketplace,
  MarketplaceOffer,
  SearchCandidateOffer,
} from '@/types/comparison';
import { MAX_CANDIDATE_POOL } from '@/lib/candidate-pool';
import { dedupeByCandidateIdentity } from '@/lib/candidate-dedupe';
import { normalizeMarketplaceRating } from '@/lib/compare-offers';
import {
  hasLargePriceSpreadAmongClose,
  reorderPickerCandidates,
} from '@/lib/match-status';
import { resolveCandidateDisplayTitle } from '@/lib/serp-title';
import { isProductPageUrl, isAliMegaMarketplace, isAliMegaSerpPriceOutlier } from '@/lib/product-match';
import { isTitleCategoryCompatible } from '@/lib/match-category';
import { sanitizeCandidateTitle } from '@/lib/serp-title';
import { tryUnambiguousSerpVerified } from '@/lib/serp-auto-pick';

/** Honest not_found — do not promise a similar-variants picker. */
export const NO_CONFIDENT_MATCH_ERROR =
  'Подходящий товар не найден. Укажите ссылку вручную или измените запрос.';

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
    error: error ?? NO_CONFIDENT_MATCH_ERROR,
  };
}

/** Собрать Top-N pool из ranked API/DOM кандидатов — успех только после card cascade */
export function buildOfferFromRankedCandidates(
  marketplace: ComparisonMarketplace,
  query: string,
  searchUrl: string,
  ranked: Array<{ offer: MarketplaceOffer; confidence: number }>,
  referenceTitle?: string,
  referencePrice?: number,
): MarketplaceOffer {
  if (!ranked.length) {
    return notFoundOffer(marketplace, query, searchUrl, 'Подходящий товар не найден в выдаче');
  }

  const refTitle =
    referenceTitle && referenceTitle.trim() && referenceTitle !== 'Товар'
      ? referenceTitle
      : query;

  let categoryFiltered = ranked.filter((r) =>
    isTitleCategoryCompatible(refTitle, r.offer.title ?? ''),
  );
  // Drop hard score-0 rejects (accessories / junk) before auto-pick / picker
  categoryFiltered = categoryFiltered.filter((r) => (r.confidence ?? 0) > 0);
  if (isAliMegaMarketplace(marketplace) && referencePrice != null && referencePrice > 0) {
    categoryFiltered = categoryFiltered.filter((r) => {
      const p = r.offer.price;
      if (p == null || p <= 0) return true;
      return !isAliMegaSerpPriceOutlier(referencePrice, p);
    });
  }
  if (!categoryFiltered.length) {
    // Prefer needs_choice only when something survived category filter but all scored 0 —
    // here nothing compatible remains → honest not_found.
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
  const unique = dedupeByCandidateIdentity(
    marketplace,
    withPrice.filter((r) => r.offer.url && isProductPageUrl(r.offer.url)),
    (r) => r.offer.url,
    (r) => r.confidence,
    (r, canonicalUrl) => ({
      ...r,
      offer: { ...r.offer, url: canonicalUrl },
    }),
  );
  const reordered = reorderPickerCandidates(
    unique,
    refTitle,
    (r) => r.offer.title ?? '',
    (r) => r.confidence,
    (r) => r.price,
  );
  const forceChoice = hasLargePriceSpreadAmongClose(reordered);

  const searchCandidates: SearchCandidateOffer[] = reordered
    .slice(0, MAX_CANDIDATE_POOL)
    .map((r, i) => ({
      title: resolveCandidateDisplayTitle({
        serpTitle: sanitizeCandidateTitle(r.offer.title ?? '', undefined, r.offer.url),
        cardTitle: r.offer.title,
        url: r.offer.url,
      }),
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

  const unambiguous =
    searchCandidates.length === 1
      ? tryUnambiguousSerpVerified(
          marketplace,
          searchCandidates.map((c) => ({
            title: c.title,
            url: c.url,
            price: c.price,
            confidence: c.matchConfidence ?? 0,
            imageUrl: c.imageUrl,
            rating: c.rating,
          })),
          { referencePrice },
        )
      : null;
  if (unambiguous) return unambiguous;

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
