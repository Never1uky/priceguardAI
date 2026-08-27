import { isOfferWithPrice } from '@/lib/compare-offers';
import { isCompareOfferSettled } from '@/lib/compare-search-progress';
import type { ComparisonMarketplace, MarketplaceOffer } from '@/types/comparison';

/** Max marketplace rows shown before «Ещё K площадок». */
export const COMPARE_TABLE_VISIBLE_ROW_LIMIT = 4;

function offerRowRank(
  offer: MarketplaceOffer,
  sourceMarketplace?: ComparisonMarketplace,
): number {
  if (sourceMarketplace && offer.marketplace === sourceMarketplace) return 0;
  if (isOfferWithPrice(offer)) return 1;
  if (!isCompareOfferSettled(offer)) return 2;
  return 3;
}

/**
 * Stable display order for compare table:
 * source → priced (asc) → loading → not_found / other.
 */
export function sortOffersForTableDisplay(
  offers: MarketplaceOffer[],
  sourceMarketplace?: ComparisonMarketplace,
): MarketplaceOffer[] {
  return [...offers].sort((a, b) => {
    const ra = offerRowRank(a, sourceMarketplace);
    const rb = offerRowRank(b, sourceMarketplace);
    if (ra !== rb) return ra - rb;
    if (ra === 1) {
      const pa = a.price ?? Number.POSITIVE_INFINITY;
      const pb = b.price ?? Number.POSITIVE_INFINITY;
      if (pa !== pb) return pa - pb;
    }
    return a.marketplace.localeCompare(b.marketplace);
  });
}

export interface CollapsedCompareTableRows {
  /** Rows to render when collapsed (or all when expanded / ≤ limit). */
  visible: MarketplaceOffer[];
  /** Offers hidden behind expand control (0 when expanded or ≤ limit). */
  hidden: MarketplaceOffer[];
  /** Count for «Ещё K площадок». */
  hiddenCount: number;
  sorted: MarketplaceOffer[];
}

/**
 * Collapse marketplace rows when more than {@link COMPARE_TABLE_VISIBLE_ROW_LIMIT}.
 * Does not filter by selection — callers already pass selected-only offers.
 */
export function collapseCompareTableRows(
  offers: MarketplaceOffer[],
  options: {
    sourceMarketplace?: ComparisonMarketplace;
    expanded: boolean;
    visibleLimit?: number;
  },
): CollapsedCompareTableRows {
  const limit = options.visibleLimit ?? COMPARE_TABLE_VISIBLE_ROW_LIMIT;
  const sorted = sortOffersForTableDisplay(offers, options.sourceMarketplace);
  if (options.expanded || sorted.length <= limit) {
    return { visible: sorted, hidden: [], hiddenCount: 0, sorted };
  }
  const visible = sorted.slice(0, limit);
  const hidden = sorted.slice(limit);
  return { visible, hidden, hiddenCount: hidden.length, sorted };
}
