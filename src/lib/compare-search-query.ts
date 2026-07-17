/**
 * Варианты поискового запроса для кросс-площадочного сравнения.
 * Артикулы разных площадок не смешиваем — только модель и ключевые слова.
 */

import { getBestTitle } from '@/lib/compare-merge';
import {
  buildModelSearchQuery,
  buildVariantSearchQuery,
  extractStorageSpecQuery,
  inferProductModel,
} from '@/lib/model-extract';
import { buildFeatureSearchQuery, extractProductFeatures } from '@/lib/product-features';
import type { CompareProduct, ComparisonMarketplace } from '@/types/comparison';

export const SEARCH_VARIANT_COUNT = 5;

export const SEARCH_VARIANT_LABELS: Record<number, string> = {
  0: 'модель + бренд',
  1: 'только модель',
  2: 'артикул (своя площадка)',
  3: 'краткое название',
  4: 'характеристики',
};

export function getSearchVariantIndex(
  product: CompareProduct,
  marketplace: ComparisonMarketplace,
): number {
  return product.searchVariantByMarketplace?.[marketplace] ?? 0;
}

/** Артикул только для целевой площадки (WB-артикул не ищем на Ozon) */
function articleForMarketplace(
  product: CompareProduct,
  marketplace: ComparisonMarketplace,
): string | undefined {
  const mpArticle = product.articlesByMarketplace?.[marketplace]?.trim();
  if (mpArticle) return mpArticle;
  if (marketplace === product.sourceMarketplace) {
    return product.article?.trim() || undefined;
  }
  return undefined;
}

export function getSearchQueryForVariant(
  product: CompareProduct,
  marketplace: ComparisonMarketplace,
  variantIndex: number,
): string {
  const title = getBestTitle(product);
  const specs =
    product.sourceOffer?.specs ??
    product.marketplaceOffers?.[product.sourceMarketplace]?.specs ??
    product.marketplaceOffers?.[marketplace]?.specs;

  const info = inferProductModel(title, specs);
  const article = articleForMarketplace(product, marketplace);
  const variant = ((variantIndex % SEARCH_VARIANT_COUNT) + SEARCH_VARIANT_COUNT) % SEARCH_VARIANT_COUNT;

  switch (variant) {
    case 0: {
      const modelQuery = product.productModel ?? info.searchQuery;
      if (modelQuery.length >= 4) return modelQuery;
      return buildModelSearchQuery(title, undefined, specs);
    }
    case 1: {
      if (info.model.length >= 3) return info.model.slice(0, 80);
      const words = title.split(/\s+/).filter((w) => w.length > 2);
      return words.slice(Math.max(0, words.length - 4)).join(' ').slice(0, 80);
    }
    case 2:
      if (article && marketplace === product.sourceMarketplace) return article;
      return info.searchQuery.length >= 4 ? info.searchQuery : title.slice(0, 80);
    case 3:
      return title
        .split(/\s+/)
        .filter((w) => w.length > 2)
        .slice(0, 5)
        .join(' ')
        .slice(0, 80);
    case 4:
      if (specs && specs.trim().length >= 4) return specs.trim().slice(0, 80);
      return buildModelSearchQuery(title, undefined, specs);
    default:
      return buildModelSearchQuery(title, undefined, specs);
  }
}

export function getEffectiveSearchQuery(
  product: CompareProduct,
  marketplace: ComparisonMarketplace,
): string {
  const variant = getSearchVariantIndex(product, marketplace);
  return sanitizeCrossMarketplaceQuery(
    getSearchQueryForVariant(product, marketplace, variant),
  );
}

/** Убирает артикулы в скобках, дубли цвета и лишние слова из поискового запроса */
export function sanitizeCrossMarketplaceQuery(query: string): string {
  return query
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\brmx\d{4,7}\b/gi, ' ')
    .replace(/\b(смартфон|телефон|android|nano-?sim)\b/gi, ' ')
    .replace(/\b(gray|grey)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

/**
 * Несколько запросов для кросс-площадочного поиска (модель, память, краткое имя).
 * Без артикула источника на чужих площадках.
 */
export function buildCrossMarketplaceQueries(
  product: CompareProduct,
  marketplace: ComparisonMarketplace,
): string[] {
  const title = getBestTitle(product);
  const specs =
    product.sourceOffer?.specs ??
    product.marketplaceOffers?.[product.sourceMarketplace]?.specs;

  const seen = new Set<string>();
  const queries: string[] = [];

  const push = (q: string | undefined) => {
    const trimmed = sanitizeCrossMarketplaceQuery(q?.trim() ?? '');
    if (!trimmed || trimmed === 'Товар' || trimmed.length < 3) return;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    queries.push(trimmed);
  };

  // Сначала структурированный запрос: brand + model + storage + color
  push(buildFeatureSearchQuery(extractProductFeatures(title, specs)));
  push(buildVariantSearchQuery(title, specs));
  push(getSearchQueryForVariant(product, marketplace, 0));

  const storageQuery = extractStorageSpecQuery(title, specs);
  if (storageQuery) {
    const info = inferProductModel(title, specs);
    if (info.model.length >= 3) {
      push(`${info.model} ${storageQuery}`.slice(0, 100));
    }
  }

  if (marketplace === product.sourceMarketplace) {
    const article = product.article?.trim();
    if (article && article.length >= 5) push(article);
  }

  return queries.slice(0, 3);
}
