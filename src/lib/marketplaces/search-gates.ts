/**
 * Category / assortment gates before opening SERP tabs for test marketplaces.
 */
import type { ComparisonMarketplace } from '@/types/comparison';
import { inferProductCategory, type ProductCategory } from '@/lib/match-category';

const LAMODA_OK: ReadonlySet<ProductCategory> = new Set([
  'apparel',
  'shoes',
  'sports',
  'kids',
  'cosmetics',
]);

/** Fashion / consumables — electronics retailers rarely help. */
const ELECTRONICS_SKIP: ReadonlySet<ProductCategory> = new Set([
  'apparel',
  'shoes',
  'cosmetics',
  'detergents',
  'pet_food',
  'home_textile',
]);

const ELECTRONICS_TAB_MPS: ReadonlySet<ComparisonMarketplace> = new Set([
  'mvideo',
  'dns',
  'citilink',
]);

export function isLamodaFashionCategory(category: ProductCategory): boolean {
  return LAMODA_OK.has(category);
}

export function isElectronicsRetailSkipCategory(category: ProductCategory): boolean {
  return ELECTRONICS_SKIP.has(category);
}

/**
 * If search on this marketplace is useless for the reference product, skip without a tab.
 */
export function marketplaceSearchSkipReason(
  marketplace: ComparisonMarketplace,
  referenceTitle: string,
  referenceSpecs?: string,
): string | null {
  const cat = inferProductCategory(referenceTitle, referenceSpecs);

  if (marketplace === 'lamoda') {
    if (isLamodaFashionCategory(cat)) return null;
    return 'Lamoda: только одежда/обувь';
  }

  if (ELECTRONICS_TAB_MPS.has(marketplace) && isElectronicsRetailSkipCategory(cat)) {
    const label =
      marketplace === 'mvideo' ? 'М.Видео' : marketplace === 'dns' ? 'DNS' : 'Ситилинк';
    return `${label}: не для одежды/бытовой химии`;
  }

  return null;
}
