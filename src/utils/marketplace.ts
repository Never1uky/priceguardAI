import type { Marketplace } from '@/types/product';
import {
  COMPARISON_MARKETPLACE_LABELS,
  COMPARISON_MARKETPLACE_SHORT_LABELS,
  getMarketplaceEntry,
} from '@/lib/marketplaces/registry';
import { getTabSearchAdapter, TAB_SEARCH_ADAPTERS } from '@/lib/marketplaces/adapter-config';

export const MARKETPLACE_LABELS: Record<Marketplace, string> = {
  ...COMPARISON_MARKETPLACE_LABELS,
};

export const MARKETPLACE_SHORT_LABELS: Record<Marketplace, string> = {
  ...COMPARISON_MARKETPLACE_SHORT_LABELS,
};

export function marketplaceBadgeVariant(
  marketplace: Marketplace,
): 'wildberries' | 'ozon' | 'yandex' | 'default' {
  return getMarketplaceEntry(marketplace)?.badgeVariant ?? 'default';
}

const PRODUCT_PAGE_PATTERNS: Record<'wildberries' | 'ozon', RegExp[]> = {
  wildberries: [
    /wildberries\.ru\/catalog\/\d+/i,
    /wildberries\.ru\/catalog\/\d+\/detail/i,
    /wildberries\.ru\/catalog\/\d+\/detail\.aspx/i,
  ],
  ozon: [
    /ozon\.ru\/product\/[^/]+/i,
    /ozon\.ru\/context\/detail\/id\/\d+/i,
    /ozon\.ru\/t\/[a-zA-Z0-9]+/i,
  ],
};

export function detectMarketplace(url: string): Marketplace | null {
  if (/wildberries\.ru/i.test(url)) return 'wildberries';
  if (/ozon\.ru/i.test(url)) return 'ozon';
  if (/market\.yandex\.ru/i.test(url) || /(?:^|\/\/)(?:www\.)?ya\.ru/i.test(url)) {
    return 'yandex_market';
  }
  for (const adapter of TAB_SEARCH_ADAPTERS) {
    if (adapter.hostPattern.test(url)) return adapter.id;
  }
  return null;
}

export function isProductPage(url?: string): boolean {
  const resolved = url ?? (typeof window !== 'undefined' ? window.location.href : '');
  if (!resolved) return false;

  if (/market\.yandex\.ru\/(product|card)\//i.test(resolved)) return true;
  if (/market\.yandex\.ru\/cc\/[a-zA-Z0-9]+/i.test(resolved)) return true;

  const marketplace = detectMarketplace(resolved);
  if (!marketplace) return false;

  const adapter = getTabSearchAdapter(marketplace);
  if (adapter) return adapter.isProductPage(resolved);

  if (marketplace === 'wildberries') {
    if (/search\.aspx/i.test(resolved)) return false;
    const match = resolved.match(/\/catalog\/(\d+)/i);
    return Boolean(match && match[1] !== '0');
  }

  if (marketplace === 'yandex_market') {
    return /\/(product|card)\//i.test(resolved);
  }

  if (marketplace === 'ozon') {
    return PRODUCT_PAGE_PATTERNS.ozon.some((pattern) => pattern.test(resolved));
  }

  return false;
}

export function extractArticle(url: string, marketplace: Marketplace): string {
  switch (marketplace) {
    case 'wildberries': {
      const match = url.match(/\/catalog\/(\d+)/i);
      return match?.[1] ?? '';
    }
    case 'ozon': {
      const seg = url.match(/\/product\/([^/?#]+)/i)?.[1] ?? '';
      const ids = [...seg.matchAll(/(\d{5,})/g)].map((m) => m[1]);
      if (ids.length) return ids[ids.length - 1]!;
      const contextMatch = url.match(/\/id\/(\d+)/i);
      return contextMatch?.[1] ?? '';
    }
    case 'yandex_market': {
      const cardMatch = url.match(/\/card\/[^/]+\/(\d+)/i);
      if (cardMatch?.[1]) return cardMatch[1];
      const productMatch = url.match(/\/product(?:--[^/]+)?\/(\d+)/i);
      return productMatch?.[1] ?? '';
    }
    default: {
      return getTabSearchAdapter(marketplace)?.extractArticle(url) ?? '';
    }
  }
}

export function buildWildberriesUrl(article: string): string {
  return `https://www.wildberries.ru/catalog/${article}/detail.aspx`;
}
