import type { ComparisonMarketplace } from '@/types/comparison';
import { toCanonicalProductUrl } from '@/utils/product-url';

const MARKETPLACE_HOSTS: Record<ComparisonMarketplace, RegExp> = {
  wildberries: /wildberries\.ru/i,
  ozon: /ozon\.ru/i,
  yandex_market: /market\.yandex\.(ru|com)/i,
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

export function buildMarketplaceSearchUrl(
  marketplace: ComparisonMarketplace,
  query: string,
): string {
  const encoded = encodeURIComponent(query);
  switch (marketplace) {
    case 'wildberries':
      return `https://www.wildberries.ru/catalog/0/search.aspx?search=${encoded}`;
    case 'ozon':
      return `https://www.ozon.ru/search/?text=${encoded}`;
    case 'yandex_market':
      return `https://market.yandex.ru/search?text=${encoded}`;
  }
}
