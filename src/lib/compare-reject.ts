/**
 * «Это не тот товар» — blacklist + next candidate из пула, иначе новый search.
 */

import { applyOffersToCompareProduct } from '@/lib/compare-offers';
import { getEffectiveSearchQuery, SEARCH_VARIANT_LABELS } from '@/lib/compare-search-query';
import {
  enrichOfferRatingIfMissing,
  resolveOfferForMarketplaceAfterReject,
} from '@/lib/marketplace-search';
import { getCompareProducts, saveCompareProducts } from '@/lib/comparison-storage';
import {
  disputeCrossMarketMapping,
  resolveSourceProductId,
} from '@/lib/cross-market-map';
import { recordMatchFeedback } from '@/lib/match-feedback';
import {
  filterPoolExcluding,
  getCandidatePool,
  markOfferRejectedKeepPool,
  normalizePoolUrl,
  offerFromPoolCandidate,
  pickNextPoolCandidate,
  poolToOfferCandidates,
  syncPoolOntoProduct,
} from '@/lib/candidate-pool';
import { ensureOfferWithPrice, isOfferWithPrice } from '@/lib/compare-offers';
import { getBestTitle } from '@/lib/compare-merge';
import {
  isAcceptableProductMatch,
  MIN_COMPARE_MATCH_CONFIDENCE,
} from '@/lib/product-match';
import type { CompareProduct, ComparisonMarketplace, MarketplaceOffer } from '@/types/comparison';

export function markOfferRejected(
  product: CompareProduct,
  marketplace: ComparisonMarketplace,
  rejectedUrl: string,
  options?: { bumpSearchVariant?: boolean },
): CompareProduct {
  return markOfferRejectedKeepPool(product, marketplace, rejectedUrl, options);
}

export function rejectVariantLabel(variantIndex: number): string {
  const key = variantIndex % 5;
  return SEARCH_VARIANT_LABELS[key] ?? 'альтернативный запрос';
}

async function disputeRejected(
  product: CompareProduct,
  marketplace: ComparisonMarketplace,
  rejectedUrl: string,
): Promise<void> {
  if (marketplace === product.sourceMarketplace) return;

  const sourceId = resolveSourceProductId({
    sourceMarketplace: product.sourceMarketplace,
    sourceUrl: product.sourceUrl,
    article: product.article,
    articlesByMarketplace: product.articlesByMarketplace,
  });
  if (!sourceId) return;

  void disputeCrossMarketMapping({
    sourceMarketplace: product.sourceMarketplace,
    sourceProductId: sourceId,
    targetMarketplace: marketplace,
    targetUrl: rejectedUrl,
  });
  void recordMatchFeedback({
    sourceMarketplace: product.sourceMarketplace,
    sourceProductId: sourceId,
    targetMarketplace: marketplace,
    candidateUrl: rejectedUrl,
    accepted: false,
  });
}

/**
 * Отклонить кандидата из needs_choice picker: blacklist + оставить остальных,
 * либо not_found если кандидатов не осталось. Без auto-bind и без нового SERP.
 * Пишет оффер напрямую (не через mergeMarketplaceOffers), иначе pending needs_choice
 * не даст перейти в not_found.
 */
export function applyRejectCompareCandidate(
  product: CompareProduct,
  marketplace: ComparisonMarketplace,
  rejectedUrl: string,
): { product: CompareProduct; offer: MarketplaceOffer } {
  const norm = normalizePoolUrl(rejectedUrl);
  const prevOffer = product.marketplaceOffers?.[marketplace];
  const rejectedTitle =
    prevOffer?.searchCandidates?.find((c) => normalizePoolUrl(c.url) === norm)?.title ??
    prevOffer?.title;

  const withBlacklist = markOfferRejectedKeepPool(product, marketplace, rejectedUrl, {
    rejectedTitle,
  });
  const rejected = withBlacklist.rejectedOfferUrls?.[marketplace] ?? [];

  const fromCandidates = prevOffer?.searchCandidates ?? [];
  const fromPool = product.candidatePoolByMarketplace?.[marketplace] ?? [];
  const sourceList = fromCandidates.length
    ? fromCandidates
    : fromPool.length
      ? fromPool
      : getCandidatePool(product, marketplace);
  const remaining = filterPoolExcluding(sourceList, rejected);

  let offer: MarketplaceOffer;
  if (remaining.length > 0) {
    offer = {
      marketplace,
      title: prevOffer?.title ?? 'Выберите товар',
      price: null,
      delivery: null,
      rating: null,
      url: prevOffer?.url && !isOfferWithPrice(prevOffer) ? prevOffer.url : '',
      imageUrl: prevOffer?.imageUrl,
      found: false,
      needsManualPick: true,
      matchStatus: 'needs_choice',
      searchCandidates: remaining,
      error: undefined,
    };
  } else {
    offer = {
      marketplace,
      title: prevOffer?.title ?? '',
      price: null,
      delivery: null,
      rating: null,
      url: '',
      found: false,
      needsManualPick: false,
      matchStatus: 'not_found',
      searchCandidates: undefined,
      error: undefined,
    };
  }

  const marketplaceUrls = { ...product.marketplaceUrls };
  if (remaining.length === 0) {
    delete marketplaceUrls[marketplace];
  }

  let next: CompareProduct = {
    ...withBlacklist,
    marketplaceUrls,
    marketplaceOffers: {
      ...withBlacklist.marketplaceOffers,
      [marketplace]: offer,
    },
    candidatePoolByMarketplace: {
      ...withBlacklist.candidatePoolByMarketplace,
      [marketplace]: remaining.length ? remaining : undefined,
    },
    comparedAt: Date.now(),
  };

  if (remaining.length) {
    next = syncPoolOntoProduct(next, marketplace, remaining);
  }

  const finalOffer = next.marketplaceOffers?.[marketplace] ?? offer;
  return { product: next, offer: finalOffer };
}

/** Persist picker reject to chrome.storage.local */
export async function rejectCompareCandidate(
  productId: string,
  marketplace: ComparisonMarketplace,
  rejectedUrl: string,
): Promise<{ product: CompareProduct; offer: MarketplaceOffer }> {
  const products = await getCompareProducts();
  const product = products.find((p) => p.id === productId);
  if (!product) throw new Error('Товар не найден в списке сравнения');

  await disputeRejected(product, marketplace, rejectedUrl);

  const { product: withOffer, offer } = applyRejectCompareCandidate(
    product,
    marketplace,
    rejectedUrl,
  );

  await saveCompareProducts([
    withOffer,
    ...products.filter((p) => p.id !== productId),
  ]);

  return { product: withOffer, offer };
}

/** Отклонить оффер → next pool candidate → иначе search */
export async function rejectAndResearchMarketplace(
  productId: string,
  marketplace: ComparisonMarketplace,
  rejectedUrl: string,
): Promise<{ product: CompareProduct; offer: MarketplaceOffer }> {
  const products = await getCompareProducts();
  const product = products.find((p) => p.id === productId);
  if (!product) throw new Error('Товар не найден в списке сравнения');

  await disputeRejected(product, marketplace, rejectedUrl);

  const nextCand = pickNextPoolCandidate(product, marketplace, rejectedUrl);
  const referenceTitle = getBestTitle(product);
  const referenceSpecs =
    product.sourceOffer?.specs ??
    product.marketplaceOffers?.[product.sourceMarketplace]?.specs;

  const nextAcceptable =
    nextCand?.url &&
    nextCand.title &&
    isAcceptableProductMatch(
      referenceTitle,
      nextCand.title,
      MIN_COMPARE_MATCH_CONFIDENCE,
      referenceSpecs,
    );

  if (nextAcceptable && nextCand?.url) {
    const updated = markOfferRejectedKeepPool(product, marketplace, rejectedUrl, {
      bumpSearchVariant: false,
    });
    const rest = poolToOfferCandidates(getCandidatePool(updated, marketplace), nextCand.url);
    let offer = offerFromPoolCandidate(marketplace, nextCand, rest);
    // S1: keep SERP price even if card enrich fails
    if (isOfferWithPrice(offer)) {
      offer = { ...offer, matchStatus: 'serp_only', found: true };
      try {
        const enriched = await enrichOfferRatingIfMissing(offer);
        if (isOfferWithPrice(enriched)) {
          offer = ensureOfferWithPrice({ ...enriched, matchStatus: 'verified' });
        }
      } catch {
        // keep serp_only
      }
    } else {
      offer = ensureOfferWithPrice(await enrichOfferRatingIfMissing(offer));
    }

    let withOffer = applyOffersToCompareProduct(updated, [offer]);
    withOffer = syncPoolOntoProduct(withOffer, marketplace, [
      {
        title: offer.title,
        url: offer.url,
        price: offer.price,
        matchConfidence: offer.matchConfidence ?? nextCand.matchConfidence,
        priority: nextCand.priority,
        imageUrl: offer.imageUrl,
        rating: offer.rating,
      },
      ...rest,
    ]);
    withOffer.comparedAt = Date.now();

    await saveCompareProducts([
      withOffer,
      ...products.filter((p) => p.id !== productId),
    ]);

    return { product: withOffer, offer };
  }

  // Пул пуст → bump variant + новый search
  const updated = markOfferRejectedKeepPool(product, marketplace, rejectedUrl, {
    bumpSearchVariant: true,
  });
  const query = getEffectiveSearchQuery(updated, marketplace);
  const rejected = updated.rejectedOfferUrls?.[marketplace] ?? [];

  const offer = await resolveOfferForMarketplaceAfterReject(
    updated,
    marketplace,
    query,
    rejected,
  );

  let withOffer = applyOffersToCompareProduct(updated, [offer]);
  if (offer.searchCandidates?.length || isOfferWithPrice(offer)) {
    const pool = [
      ...(offer.url && isOfferWithPrice(offer)
        ? [
            {
              title: offer.title,
              url: offer.url,
              price: offer.price,
              matchConfidence: offer.matchConfidence ?? 70,
              imageUrl: offer.imageUrl,
              rating: offer.rating,
            },
          ]
        : []),
      ...(offer.searchCandidates ?? []),
    ];
    withOffer = syncPoolOntoProduct(withOffer, marketplace, pool);
  }
  withOffer.comparedAt = Date.now();

  await saveCompareProducts([
    withOffer,
    ...products.filter((p) => p.id !== productId),
  ]);

  return { product: withOffer, offer };
}
