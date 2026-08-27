/**
 * Order compare targets: known URL → costTier api → costTier tab.
 */
import type { CompareProduct, ComparisonMarketplace } from '@/types/comparison';
import { marketplaceCostTier } from '@/lib/marketplaces/registry';

export function compareTargetPriority(
  product: CompareProduct,
  marketplace: ComparisonMarketplace,
): number {
  const knownUrl = Boolean(product.marketplaceUrls?.[marketplace]?.trim());
  if (knownUrl) return 0;
  if (marketplaceCostTier(marketplace) === 'api') return 1;
  if (marketplaceCostTier(marketplace) === 'tab') return 3;
  return 2;
}

export function sortCompareTargets(
  product: CompareProduct,
  targets: ComparisonMarketplace[],
): ComparisonMarketplace[] {
  return [...targets].sort((a, b) => {
    const d = compareTargetPriority(product, a) - compareTargetPriority(product, b);
    if (d !== 0) return d;
    return 0;
  });
}
