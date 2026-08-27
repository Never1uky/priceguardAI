import type { ComparisonMarketplace } from '@/types/comparison';
import { toCanonicalProductUrl } from '@/utils/product-url';
import { getTabSearchAdapter, TAB_SEARCH_ADAPTERS } from '@/lib/marketplaces/adapter-config';

const CORE_HOSTS: Partial<Record<ComparisonMarketplace, RegExp>> = {
  wildberries: /wildberries\.ru/i,
  ozon: /ozon\.ru/i,
  // ya.ru — короткие ссылки Маркета (как в safe-marketplace-url)
  yandex_market: /market\.yandex\.(ru|com)|(?:^|\/\/)(?:www\.)?ya\.ru/i,
};

const MARKETPLACE_HOSTS: Record<ComparisonMarketplace, RegExp> = {
  wildberries: CORE_HOSTS.wildberries!,
  ozon: CORE_HOSTS.ozon!,
  yandex_market: CORE_HOSTS.yandex_market!,
  ...Object.fromEntries(TAB_SEARCH_ADAPTERS.map((a) => [a.id, a.hostPattern])),
} as Record<ComparisonMarketplace, RegExp>;

const CORE_ORIGIN: Partial<Record<ComparisonMarketplace, string>> = {
  wildberries: 'https://www.wildberries.ru',
  ozon: 'https://www.ozon.ru',
  yandex_market: 'https://market.yandex.ru',
};

const MARKETPLACE_ORIGIN: Record<ComparisonMarketplace, string> = {
  wildberries: CORE_ORIGIN.wildberries!,
  ozon: CORE_ORIGIN.ozon!,
  yandex_market: CORE_ORIGIN.yandex_market!,
  ...Object.fromEntries(TAB_SEARCH_ADAPTERS.map((a) => [a.id, a.origin])),
} as Record<ComparisonMarketplace, string>;

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
      return getTabSearchAdapter(marketplace)?.extractArticle(url) ?? '';
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
      default:
        return getTabSearchAdapter(marketplace)?.isSerp(url, path) ?? false;
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
      parsed.searchParams.get('q') ||
      parsed.searchParams.get('SearchText') ||
      parsed.searchParams.get('query') ||
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
    default: {
      const adapter = getTabSearchAdapter(marketplace);
      return adapter ? adapter.searchUrl(encoded) : '';
    }
  }
}

export function marketplaceOrigin(marketplace: ComparisonMarketplace): string {
  return MARKETPLACE_ORIGIN[marketplace];
}

export function marketplaceUrlPlaceholder(marketplace: ComparisonMarketplace): string {
  const adapter = getTabSearchAdapter(marketplace);
  if (adapter) return adapter.urlPlaceholder;
  switch (marketplace) {
    case 'wildberries':
      return 'https://www.wildberries.ru/catalog/...';
    case 'ozon':
      return 'https://www.ozon.ru/product/...';
    case 'yandex_market':
      return 'https://market.yandex.ru/product/...';
    default:
      return 'https://…';
  }
}
