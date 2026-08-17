/**
 * Варианты поискового запроса для кросс-площадочного сравнения.
 * Артикулы разных площадок не смешиваем — только модель и ключевые слова.
 */

import { getBestTitle } from '@/lib/compare-merge';
import {
  buildPrimaryEntityQuery,
  buildPrimaryWithHostQuery,
  enforcePrimaryLeadQuery,
  extractEntityFromTitle,
} from '@/lib/entity-extract';
import { isDependentProductRole } from '@/lib/match-rules/types';
import {
  buildModelSearchQuery,
  buildVariantSearchQuery,
  extractStorageSpecQuery,
  inferProductModel,
  stripCategoryQueryNoise,
} from '@/lib/model-extract';
import { buildFeatureSearchQuery, extractProductFeatures } from '@/lib/product-features';
import { inferProductCategory } from '@/lib/match-category';
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

  const entity = extractEntityFromTitle(title, specs);
  // Host primary: model/query from title only — specs kit lines must not inject DualSense etc.
  const info =
    entity.productRole === 'primary'
      ? inferProductModel(title)
      : inferProductModel(title, specs);
  const article = articleForMarketplace(product, marketplace);
  const variant = ((variantIndex % SEARCH_VARIANT_COUNT) + SEARCH_VARIANT_COUNT) % SEARCH_VARIANT_COUNT;

  // Dependent roles: lead with primary entity; host only as secondary flavour
  if (isDependentProductRole(entity.productRole) && entity.primaryEntity.length >= 3) {
    const lead = buildPrimaryEntityQuery(entity);
    const withHost = buildPrimaryWithHostQuery(entity);
    switch (variant) {
      case 0:
      case 4:
        return lead || info.searchQuery;
      case 1:
        return entity.primaryEntity.slice(0, 80);
      case 2:
        if (article && marketplace === product.sourceMarketplace) return article;
        return lead || info.searchQuery;
      case 3:
        return withHost ?? lead ?? info.searchQuery;
      default:
        return lead || info.searchQuery;
    }
  }

  switch (variant) {
    case 0: {
      const fromTitle = info.searchQuery;
      const stored = product.productModel;
      const modelQuery = preferQueryWithGeneration(stored, fromTitle, title);
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
  const title = getBestTitle(product);
  return sanitizeCrossMarketplaceQuery(
    getSearchQueryForVariant(product, marketplace, variant),
    title,
  );
}

/** Убирает артикулы в скобках, дубли цвета и лишние слова из поискового запроса */
export function sanitizeCrossMarketplaceQuery(query: string, titleHint?: string): string {
  let q = query
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\brmx\d{4,7}\b/gi, ' ')
    .replace(/\b(смартфон|телефон|android|nano-?sim)\b/gi, ' ')
    .replace(/\b(gray|grey)\b/gi, ' ')
    .replace(/(?<!\d)(?:\s|^)(?:гб|gb)\b/gi, ' ')
    .replace(/[,\s]*,[,\s]*,+/g, ' ')
    .replace(/\s*,\s*/g, ' ')
    // "Google Google Pixel" → "Google Pixel"
    .replace(/\b([A-Za-zА-Яа-яЁё]{2,})\s+\1\b/gi, '$1')
    .replace(/\s+/g, ' ')
    .trim();

  if (titleHint) {
    q = ensureGenerationTokenInQuery(q, titleHint);
    q = stripCategoryQueryNoise(inferProductCategory(titleHint), q);
    q = enforcePrimaryLeadQuery(q, titleHint);
  }
  return sliceQueryByWords(q, 80);
}

/**
 * If the title has Pixel 7 / iPhone 15 / Redmi 13 but the query lost the digit,
 * reinject it (prevents SERP matching Pixel 6 / wrong generation).
 */
export function ensureGenerationTokenInQuery(query: string, title: string): string {
  const patterns: Array<{ re: RegExp; family: string }> = [
    { re: /\b(?:google\s+)?(pixel)\s*(\d{1,2}[a-z]?(?:\s*(?:pro|xl))?)\b/i, family: 'pixel' },
    { re: /\b(iphone)\s*(\d{1,2}(?:\s*(?:pro|plus|max|mini))?)\b/i, family: 'iphone' },
    { re: /\b(redmi(?:\s+note)?)\s*(\d{1,2}[a-z]?)\b/i, family: 'redmi' },
  ];

  for (const { re } of patterns) {
    const m = title.match(re);
    if (!m) continue;
    const family = m[1]!.replace(/\s+/g, ' ').trim();
    const gen = m[2]!.replace(/\s+/g, '').trim();
    const full = new RegExp(
      `\\b${family.replace(/\s+/g, '\\s+')}\\s*${gen.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
      'i',
    );
    if (full.test(query)) return query;

    const bareFamily = new RegExp(`\\b${family.replace(/\s+/g, '\\s+')}\\b(?!\\s*\\d)`, 'i');
    if (bareFamily.test(query)) {
      return query.replace(bareFamily, `${family} ${gen}`);
    }
    return `${query} ${family} ${gen}`.replace(/\s+/g, ' ').trim();
  }
  return query;
}

/** Prefer stored productModel only when it still carries the generation digit from title. */
function preferQueryWithGeneration(
  stored: string | undefined,
  fromTitle: string,
  title: string,
): string {
  const genMatch =
    title.match(/\bpixel\s*(\d{1,2}[a-z]?)/i) ??
    title.match(/\biphone\s*(\d{1,2})/i) ??
    title.match(/\bredmi(?:\s+note)?\s*(\d{1,2}[a-z]?)/i);
  if (!genMatch) {
    return stored && stored.length >= 4 ? stored : fromTitle;
  }
  const digit = genMatch[1]!;
  const hasDigit = (q: string) => new RegExp(digit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(q);
  if (stored && stored.length >= 4 && hasDigit(stored)) return stored;
  if (fromTitle.length >= 4 && hasDigit(fromTitle)) return fromTitle;
  if (stored && stored.length >= 4) return stored;
  return fromTitle;
}

function sliceQueryByWords(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  const cut = trimmed.slice(0, max);
  const sp = cut.lastIndexOf(' ');
  return (sp >= Math.floor(max * 0.5) ? cut.slice(0, sp) : cut).trim();
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
    const trimmed = sanitizeCrossMarketplaceQuery(q?.trim() ?? '', title);
    if (!trimmed || trimmed === 'Товар' || trimmed.length < 3) return;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    queries.push(trimmed);
  };

  // Сначала primary-entity lead для accessory/consumable
  const entity = extractEntityFromTitle(title, specs);
  if (isDependentProductRole(entity.productRole)) {
    push(buildPrimaryEntityQuery(entity));
    push(buildPrimaryWithHostQuery(entity));
  }

  // Затем структурированный запрос: brand + model + storage + color
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
