/**
 * Разбор пользовательского ввода для вкладки «Отзывы»:
 * ссылка на карточку или артикул Wildberries (без SERP по модели).
 */

import type { Marketplace } from '@/types/product';
import {
  detectComparisonMarketplace,
  extractComparisonArticle,
  normalizeCompareUrl,
} from '@/utils/comparison-url';
import { getMarketplaceEntry } from '@/lib/marketplaces/registry';
import { buildWildberriesUrl, detectMarketplace } from '@/utils/marketplace';
import { toCanonicalProductUrl } from '@/utils/product-url';

export type ReviewInputKind = 'url' | 'article' | 'model';

export interface ResolvedReviewTarget {
  productTitle: string;
  productUrl: string;
  marketplace: Marketplace;
  article?: string;
  productId: string;
  resolvedVia: 'url' | 'article' | 'search';
}

const URL_PATTERN = /^https?:\/\//i;
const ARTICLE_PATTERN = /^\d{5,12}$/;

export function classifyReviewInput(raw: string): ReviewInputKind {
  const trimmed = raw.trim();
  if (URL_PATTERN.test(trimmed)) return 'url';
  if (ARTICLE_PATTERN.test(trimmed)) return 'article';
  return 'model';
}

export function targetFromUrl(url: string): ResolvedReviewTarget {
  const marketplace = detectComparisonMarketplace(url) ?? detectMarketplace(url);
  if (!marketplace) {
    throw new Error('Поддерживаются ссылки Wildberries, Ozon, Яндекс.Маркет и AliExpress');
  }
  if (getMarketplaceEntry(marketplace)?.capabilities.reviews !== true) {
    throw new Error(
      'Отзывы для этой площадки пока недоступны. Используйте ссылку WB, Ozon, Я.Маркет или AliExpress.',
    );
  }

  const canonical = normalizeCompareUrl(url);
  const article = extractComparisonArticle(canonical, marketplace) || undefined;

  return {
    productTitle: 'Товар',
    productUrl: toCanonicalProductUrl(canonical, marketplace),
    marketplace,
    article,
    productId: article ? `review_${marketplace}_${article}` : `review_${Date.now()}`,
    resolvedVia: 'url',
  };
}

function targetFromWbArticle(article: string): ResolvedReviewTarget {
  const trimmed = article.trim();
  const url = buildWildberriesUrl(trimmed);
  return {
    productTitle: 'Товар Wildberries',
    productUrl: toCanonicalProductUrl(url, 'wildberries'),
    marketplace: 'wildberries',
    article: trimmed,
    productId: `review_wildberries_${trimmed}`,
    resolvedVia: 'article',
  };
}

/**
 * Резолв цели для отзывов: только URL или артикул WB.
 * Модель / Ozon-YM article без ссылки — сразу ошибка (без SERP).
 */
export async function resolveReviewTarget(
  input: string,
  _marketplace?: Marketplace,
): Promise<ResolvedReviewTarget> {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error('Вставьте ссылку на карточку или артикул Wildberries');
  }

  const kind = classifyReviewInput(trimmed);
  if (kind === 'url') return targetFromUrl(trimmed);
  if (kind === 'article') return targetFromWbArticle(trimmed);

  throw new Error(
    'Поиск по модели отключён. Вставьте ссылку на карточку (WB / Ozon / YM / AliExpress) или артикул Wildberries.',
  );
}

/** @deprecated Используйте resolveReviewTarget — SERP по модели убран */
export async function resolveReviewTargetBySearch(
  query: string,
  marketplace: Marketplace,
): Promise<ResolvedReviewTarget> {
  return resolveReviewTarget(query, marketplace);
}

/** URL → одна цель; артикул → только WB */
export async function resolveReviewTargets(input: string): Promise<ResolvedReviewTarget[]> {
  const trimmed = input.trim();
  if (!trimmed) return [];

  const kind = classifyReviewInput(trimmed);
  if (kind === 'url') return [targetFromUrl(trimmed)];
  if (kind === 'article') return [targetFromWbArticle(trimmed)];
  return [];
}
