/**
 * Human-readable compare search progress (privacy-safe: marketplace labels only).
 */
import { SEARCHING_MP_CROSS, type SearchingMarketplaceKey } from '@/lib/compare-jobs';
import { isOfferWithPrice } from '@/lib/compare-offers';
import type { ComparisonMarketplace, MarketplaceOffer } from '@/types/comparison';
import { COMPARISON_MARKETPLACE_SHORT_LABELS } from '@/lib/marketplaces/registry';

const SHORT = COMPARISON_MARKETPLACE_SHORT_LABELS;

export function isCompareOfferSettled(offer: MarketplaceOffer): boolean {
  if (offer.matchStatus === 'loading_card') return false;
  return (
    Boolean(offer.needsManualPick) ||
    offer.matchStatus === 'not_found' ||
    offer.matchStatus === 'needs_choice' ||
    offer.matchStatus === 'blocked' ||
    isOfferWithPrice(offer)
  );
}

/** Step index 1..total for «Ищем на Ozon… 2/N». */
export function compareSearchStep(
  offers: MarketplaceOffer[],
  searchingMarketplace?: SearchingMarketplaceKey | null,
): { step: number; total: number } {
  const total = Math.max(offers.length, 1);
  const settled = offers.filter(isCompareOfferSettled).length;
  if (searchingMarketplace === SEARCHING_MP_CROSS) {
    return { step: Math.min(Math.max(settled, 1), total), total };
  }
  if (searchingMarketplace) {
    const idx = offers.findIndex((o) => o.marketplace === searchingMarketplace);
    if (idx >= 0 && !isCompareOfferSettled(offers[idx]!)) {
      return { step: Math.min(settled + 1, total), total };
    }
  }
  return { step: Math.min(Math.max(settled, 1), total), total };
}

export function formatCompareSearchProgress(opts: {
  offers: MarketplaceOffer[];
  searchingMarketplace?: SearchingMarketplaceKey | null;
  isLoading?: boolean;
}): string | null {
  const { offers, searchingMarketplace, isLoading } = opts;
  if (!isLoading) return null;

  const { step, total } = compareSearchStep(offers, searchingMarketplace);

  if (searchingMarketplace === SEARCHING_MP_CROSS) {
    const n = Math.max(offers.length, total);
    return `Ищем на ${n} площадках… ${step}/${total}`;
  }
  if (searchingMarketplace) {
    return `Ищем на ${SHORT[searchingMarketplace as ComparisonMarketplace]}… ${step}/${total}`;
  }
  return `Сравниваем цены… ${step}/${total}`;
}

/** Compact row label when only SEARCHING_MP_KEY is known (list view). */
export function formatSearchingMpCompact(
  searchingMarketplace: SearchingMarketplaceKey | null | undefined,
  selectedCount?: number,
): string {
  if (!searchingMarketplace) return 'Ищем…';
  if (searchingMarketplace === SEARCHING_MP_CROSS) {
    const n = selectedCount && selectedCount > 0 ? selectedCount : undefined;
    return n ? `Ищем… 1/${n}` : 'Ищем…';
  }
  return `Ищем на ${SHORT[searchingMarketplace as ComparisonMarketplace]}…`;
}
