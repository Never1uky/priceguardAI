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
  getCandidatePool,
  markOfferRejectedKeepPool,
  offerFromPoolCandidate,
  pickNextPoolCandidate,
  poolToOfferCandidates,
  syncPoolOntoProduct,
} from '@/lib/candidate-pool';
import { ensureOfferWithPrice, isOfferWithPrice } from '@/lib/compare-offers';
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

  if (nextCand?.url) {
    const updated = markOfferRejectedKeepPool(product, marketplace, rejectedUrl, {
      bumpSearchVariant: false,
    });
    const rest = poolToOfferCandidates(getCandidatePool(updated, marketplace), nextCand.url);
    let offer = offerFromPoolCandidate(marketplace, nextCand, rest);
    offer = ensureOfferWithPrice(await enrichOfferRatingIfMissing(offer));

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
