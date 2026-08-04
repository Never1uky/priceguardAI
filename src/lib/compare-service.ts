import { shouldRunCompare } from '@/lib/compare-cache';
import { offersFromCompareProduct } from '@/lib/compare-offers';
import { compareAndUpdateProduct } from '@/lib/marketplace-search';
import {
  getCompareProducts,
  setSelectedCompareId,
  updateCompareProduct,
} from '@/lib/comparison-storage';
import { resolveAndAddCompareProduct } from '@/lib/compare-resolve';
import {
  clearBoundOffer,
  isResearchPreservedSlot,
  researchClearAutoOnly,
} from '@/lib/candidate-pool';
import { isSameProductPage } from '@/lib/reviews/tab-resolver';
import type {
  CompareProduct,
  CompareProductHint,
  ComparisonMarketplace,
  MarketplaceOffer,
} from '@/types/comparison';

export interface EnsureCompareResult {
  product: CompareProduct;
  offers: MarketplaceOffer[];
  fromCache: boolean;
}

export interface RefreshCompareOptions {
  onProgress?: (product: CompareProduct) => Promise<void> | void;
  /** refresh = цены по bound; research = полный поиск */
  mode?: 'refresh' | 'research';
  /** Skip Premium Scrappey unlocker (client backup / periodic) */
  skipUnlocker?: boolean;
  /** Restrict target search to these marketplaces */
  onlyMarketplaces?: ComparisonMarketplace[];
}

/** Добавить товар в сравнение и при необходимости запустить поиск (один раз, с кэшем). */
export async function ensureCompareProduct(
  url: string,
  article?: string,
  hint?: CompareProductHint,
  options?: { forceCompare?: boolean },
): Promise<EnsureCompareResult> {
  const product = await resolveAndAddCompareProduct(url, article, hint);
  await setSelectedCompareId(product.id);

  if (!shouldRunCompare(product, options?.forceCompare)) {
    return {
      product,
      offers: offersFromCompareProduct(product),
      fromCache: true,
    };
  }

  const { offers, product: updated } = await compareAndUpdateProduct(product, {
    force: options?.forceCompare,
    mode: 'research',
  });

  const withTimestamp: CompareProduct = { ...updated, comparedAt: Date.now() };
  await updateCompareProduct(withTimestamp);

  return { product: withTimestamp, offers, fromCache: false };
}

/** Обновить сравнение для уже добавленного товара. */
export async function refreshCompareProduct(
  product: CompareProduct,
  force = true,
  options?: RefreshCompareOptions,
): Promise<EnsureCompareResult> {
  if (!shouldRunCompare(product, force)) {
    return {
      product,
      offers: offersFromCompareProduct(product),
      fromCache: true,
    };
  }

  const { offers, product: updated } = await compareAndUpdateProduct(product, {
    force,
    mode: options?.mode ?? 'refresh',
    onProgress: options?.onProgress,
    skipUnlocker: options?.skipUnlocker,
    onlyMarketplaces: options?.onlyMarketplaces,
  });
  const withTimestamp: CompareProduct = { ...updated, comparedAt: Date.now() };
  await updateCompareProduct(withTimestamp);

  return { product: withTimestamp, offers, fromCache: false };
}

/** Сбросить bound на target-площадках и запустить полный поиск (с blacklist). */
export async function researchCompareProduct(
  product: CompareProduct,
  options?: RefreshCompareOptions,
): Promise<EnsureCompareResult> {
  const cleared = researchClearAutoOnly(product);
  await updateCompareProduct(cleared);
  return refreshCompareProduct(cleared, true, {
    ...options,
    mode: 'research',
    onlyMarketplaces: undefined,
  });
}

/** Сбросить один авто-слот и найти товар только на этой площадке. */
export async function researchSingleMarketplace(
  product: CompareProduct,
  marketplace: ComparisonMarketplace,
  options?: RefreshCompareOptions,
): Promise<EnsureCompareResult> {
  if (marketplace === product.sourceMarketplace) {
    return refreshCompareProduct(product, true, {
      ...options,
      mode: 'refresh',
    });
  }

  const cleared = isResearchPreservedSlot(product, marketplace)
    ? product
    : clearBoundOffer(product, marketplace, { clearPool: true });
  await updateCompareProduct(cleared);
  return refreshCompareProduct(cleared, true, {
    ...options,
    mode: 'research',
    onlyMarketplaces: [marketplace],
  });
}

export async function findCompareProductByUrl(url: string): Promise<CompareProduct | null> {
  const products = await getCompareProducts();
  const trimmed = url.trim();
  return (
    products.find(
      (p) =>
        p.sourceUrl === trimmed ||
        p.sourceUrl.split('?')[0] === trimmed.split('?')[0] ||
        isSameProductPage(p.sourceUrl, trimmed),
    ) ?? null
  );
}
