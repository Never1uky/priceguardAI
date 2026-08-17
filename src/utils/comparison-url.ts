import type { ComparisonMarketplace } from '@/types/comparison';
import { toCanonicalProductUrl } from '@/utils/product-url';

const MARKETPLACE_HOSTS: Record<ComparisonMarketplace, RegExp> = {
  wildberries: /wildberries\.ru/i,
  ozon: /ozon\.ru/i,
  // ya.ru — короткие ссылки Маркета (как в safe-marketplace-url)
  yandex_market: /market\.yandex\.(ru|com)|(?:^|\/\/)(?:www\.)?ya\.ru/i,
};

const MARKETPLACE_ORIGIN: Record<ComparisonMarketplace, string> = {
  wildberries: 'https://www.wildberries.ru',
  ozon: 'https://www.ozon.ru',
  yandex_market: 'https://market.yandex.ru',
};

export function detectComparisonMarketplace(url: string): ComparisonMarketplace | null {
  for (const [marketplace, pattern] of Object.entries(MARKETPLACE_HOSTS) as [
    ComparisonMarketplace,
    RegExp,
  ][]) {
    if (pattern.test(url)) return marketplace;
  }
  return null;
}

/**
 * Trim + absolute URL for compare pick / manual paste.
 * Relative paths resolve against the selected marketplace origin.
 */
export function resolveCompareCandidateUrl(
  raw: string,
  marketplace?: ComparisonMarketplace | null,
): string {
  const trimmed = raw.trim().replace(/^['"]+|['"]+$/g, '');
  if (!trimmed) return '';

  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('//')) return `https:${trimmed}`;

  if (trimmed.startsWith('/') && marketplace) {
    return `${MARKETPLACE_ORIGIN[marketplace]}${trimmed}`;
  }

  // Bare path fragment (product--… / catalog/…)
  if (marketplace && /^[\w./%-]+/.test(trimmed) && !/\s/.test(trimmed)) {
    const path = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
    return `${MARKETPLACE_ORIGIN[marketplace]}${path}`;
  }

  return trimmed;
}

export function isSupportedCompareUrl(url: string): boolean {
  return detectComparisonMarketplace(url) !== null;
}

export function normalizeCompareUrl(url: string): string {
  try {
    const parsed = new URL(url.trim());
    const marketplace = detectComparisonMarketplace(url);
    if (marketplace) {
      return toCanonicalProductUrl(url, marketplace);
    }
    return `${parsed.origin}${parsed.pathname.replace(/\/$/, '')}`;
  } catch {
    return url.trim();
  }
}

export function extractComparisonArticle(
  url: string,
  marketplace: ComparisonMarketplace,
): string {
  switch (marketplace) {
    case 'wildberries': {
      const match = url.match(/\/catalog\/(\d+)/i);
      return match?.[1] ?? '';
    }
    case 'ozon': {
      const productMatch = url.match(/\/product\/[^/]+-(\d+)/i);
      if (productMatch?.[1]) return productMatch[1];
      const contextMatch = url.match(/\/id\/(\d+)/i);
      return contextMatch?.[1] ?? '';
    }
    case 'yandex_market': {
      const cardMatch = url.match(/\/card\/[^/]+\/(\d+)/i);
      if (cardMatch?.[1]) return cardMatch[1];
      const productMatch = url.match(/\/product(?:--[^/]+)?\/(\d+)/i);
      return productMatch?.[1] ?? '';
    }
    default:
      return '';
  }
}

/** True if `url` is a search listing (SERP) for this marketplace — not a product card. */
export function isMarketplaceSerpUrl(
  url: string,
  marketplace: ComparisonMarketplace,
): boolean {
  if (detectComparisonMarketplace(url) !== marketplace) return false;
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.toLowerCase();
    switch (marketplace) {
      case 'wildberries':
        return /search\.aspx/i.test(path) || /\/catalog\/0\/search/i.test(path);
      case 'ozon':
        return /\/search\/?/i.test(path);
      case 'yandex_market':
        return /\/search\/?/i.test(path);
    }
  } catch {
    return false;
  }
}

/**
 * Whether an open SERP tab is related enough to reuse (same marketplace search query).
 * Empty/unknown query param → try the tab anyway.
 */
export function serpSearchQueryRelated(tabUrl: string, searchQuery: string): boolean {
  try {
    const parsed = new URL(tabUrl);
    const q = (
      parsed.searchParams.get('search') ||
      parsed.searchParams.get('text') ||
      ''
    ).toLowerCase();
    if (!q) return true;
    const tokens = searchQuery
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((t) => t.length > 1);
    if (!tokens.length) return true;
    const hits = tokens.filter((t) => q.includes(t)).length;
    return hits >= Math.min(2, tokens.length);
  } catch {
    return true;
  }
}

export function buildMarketplaceSearchUrl(
  marketplace: ComparisonMarketplace,
  query: string,
): string {
  const encoded = encodeURIComponent(query);
  switch (marketplace) {
    case 'wildberries':
      return `https://www.wildberries.ru/catalog/0/search.aspx?search=${encoded}`;
    case 'ozon':
      // from_global + deny_* — меньше редиректов на /category/…prediction
      return (
        `https://www.ozon.ru/search/?text=${encoded}` +
        `&deny_category_prediction=true&from_global=true&__rr=1`
      );
    case 'yandex_market':
      return `https://market.yandex.ru/search?text=${encoded}`;
  }
}
