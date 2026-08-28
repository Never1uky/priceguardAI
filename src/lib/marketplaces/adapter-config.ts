/**
 * URL / SERP / article config for tab-search marketplaces (Megamarket + test MPs).
 * No invented HTTP APIs — card scrape + SERP candidates + hidden-tab search only.
 */

import type { MarketplaceId } from '@/lib/marketplaces/registry';

export interface TabSearchAdapterConfig {
  id: MarketplaceId;
  hostPattern: RegExp;
  hostSuffixes: string[];
  origin: string;
  searchUrl: (encodedQuery: string) => string;
  isProductPage: (url: string) => boolean;
  isSerp: (url: string, path: string) => boolean;
  extractArticle: (url: string) => string;
  /** href fragment that identifies a product card on SERP */
  serpProductHref: RegExp;
  serpTabPatterns: string[];
  serpPollMs: number;
  urlPlaceholder: string;
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url.split('?')[0]?.split('#')[0] ?? url;
  }
}

function trailingDigits(path: string, min = 5): string {
  const m = path.replace(/\/+$/, '').match(new RegExp(`(\\d{${min},})$`));
  return m?.[1] ?? '';
}

export const TAB_SEARCH_ADAPTERS: readonly TabSearchAdapterConfig[] = [
  {
    id: 'megamarket',
    hostPattern: /megamarket\.ru|sbermegamarket\.ru/i,
    hostSuffixes: ['megamarket.ru', 'sbermegamarket.ru'],
    origin: 'https://megamarket.ru',
    searchUrl: (q) => `https://megamarket.ru/catalog/?q=${q}`,
    isProductPage: (url) => /\/catalog\/details\//i.test(url),
    isSerp: (url, path) =>
      /\/catalog\/\?/i.test(url) || /[?&]q=/i.test(url) || /\/search/i.test(path),
    extractArticle: (url) => {
      const details = url.match(/\/catalog\/details\/[^/?#]*?(\d{6,})\/?(?:[?#]|$)/i);
      if (details?.[1]) return details[1];
      const bare = url.match(/\/catalog\/details\/(\d{6,})\/?/i);
      return bare?.[1] ?? '';
    },
    serpProductHref: /\/catalog\/details\//i,
    serpTabPatterns: ['*://*.megamarket.ru/catalog*', '*://*.sbermegamarket.ru/catalog*'],
    serpPollMs: 8_000,
    urlPlaceholder: 'https://megamarket.ru/catalog/details/...',
  },
  {
    id: 'aliexpress',
    hostPattern: /aliexpress\.ru/i,
    hostSuffixes: ['aliexpress.ru'],
    origin: 'https://aliexpress.ru',
    searchUrl: (q) => `https://aliexpress.ru/wholesale?SearchText=${q}`,
    isProductPage: (url) => /\/item\/\d{8,}(?:\.html)?/i.test(url),
    isSerp: (url, path) =>
      /\/wholesale/i.test(path) ||
      /\/premium\/search/i.test(path) ||
      (/\/af\//i.test(path) && /SearchText=/i.test(url)),
    extractArticle: (url) => {
      const m = url.match(/\/item\/(\d{8,})(?:\.html)?/i);
      return m?.[1] ?? '';
    },
    serpProductHref: /\/item\/\d{8,}/i,
    serpTabPatterns: [
      '*://*.aliexpress.ru/wholesale*',
      '*://aliexpress.ru/wholesale*',
      '*://*.aliexpress.ru/*search*',
      '*://aliexpress.ru/af/*',
    ],
    serpPollMs: 9_000,
    urlPlaceholder: 'https://aliexpress.ru/item/100500….html',
  },
  {
    id: 'mvideo',
    // М.Видео + Эльдорадо (одна сеть) — единый id `mvideo`
    hostPattern: /mvideo\.ru|eldorado\.ru/i,
    hostSuffixes: ['mvideo.ru', 'eldorado.ru'],
    origin: 'https://www.mvideo.ru',
    searchUrl: (q) => `https://www.mvideo.ru/product-list-page?q=${q}`,
    isProductPage: (url) => {
      if (/eldorado\.ru/i.test(url)) {
        return (
          /\/cat\/detail\//i.test(url) ||
          /\/item\/\d+/i.test(url) ||
          /\/catalog\/product\//i.test(url)
        );
      }
      return /\/products\/[^/?#]+/i.test(url) && !/product-list-page/i.test(url);
    },
    isSerp: (url, path) => {
      if (/eldorado\.ru/i.test(url)) {
        return /\/search/i.test(path) || /catalog\.php/i.test(url);
      }
      return /product-list-page/i.test(path) || /\/search/i.test(path);
    },
    extractArticle: (url) => {
      if (/eldorado\.ru/i.test(url)) {
        const item = url.match(/\/item\/(\d+)/i)?.[1];
        if (item) return item;
        const path = pathOf(url);
        const trailing = trailingDigits(path, 5);
        if (trailing) return trailing;
        return path.match(/\/cat\/detail\/([^/?#]+)/i)?.[1] ?? '';
      }
      const path = pathOf(url);
      const fromSlug = trailingDigits(path, 6);
      if (fromSlug) return fromSlug;
      return url.match(/\/products\/(\d+)/i)?.[1] ?? '';
    },
    serpProductHref: /\/products\/[^/?#]+|\/cat\/detail\/|\/item\/\d+|\/catalog\/product\//i,
    serpTabPatterns: [
      '*://*.mvideo.ru/product-list-page*',
      '*://*.mvideo.ru/*search*',
      '*://*.eldorado.ru/search*',
      '*://*.eldorado.ru/catalog*',
    ],
    serpPollMs: 8_000,
    urlPlaceholder: 'https://www.mvideo.ru/products/...',
  },
  {
    id: 'dns',
    hostPattern: /dns-shop\.ru/i,
    hostSuffixes: ['dns-shop.ru'],
    origin: 'https://www.dns-shop.ru',
    searchUrl: (q) => `https://www.dns-shop.ru/search/?q=${q}`,
    isProductPage: (url) => /\/product\/[a-z0-9]+/i.test(url) && !/\/search/i.test(url),
    isSerp: (_url, path) => /\/search/i.test(path),
    extractArticle: (url) => url.match(/\/product\/([a-z0-9]+)/i)?.[1] ?? '',
    serpProductHref: /\/product\/[a-z0-9]+/i,
    serpTabPatterns: ['*://*.dns-shop.ru/search*'],
    serpPollMs: 8_000,
    urlPlaceholder: 'https://www.dns-shop.ru/product/...',
  },
  {
    id: 'citilink',
    hostPattern: /citilink\.ru/i,
    hostSuffixes: ['citilink.ru'],
    origin: 'https://www.citilink.ru',
    searchUrl: (q) => `https://www.citilink.ru/search/?text=${q}`,
    isProductPage: (url) => /\/product\/[^/?#]+/i.test(url) && !/\/search/i.test(url),
    isSerp: (_url, path) => /\/search/i.test(path),
    extractArticle: (url) => {
      const path = pathOf(url);
      const trailing = trailingDigits(path, 5);
      if (trailing) return trailing;
      return url.match(/\/product\/(\d+)/i)?.[1] ?? '';
    },
    serpProductHref: /\/product\/[^/?#]+/i,
    serpTabPatterns: ['*://*.citilink.ru/search*'],
    serpPollMs: 8_000,
    urlPlaceholder: 'https://www.citilink.ru/product/...',
  },
  {
    id: 'lamoda',
    hostPattern: /lamoda\.ru/i,
    hostSuffixes: ['lamoda.ru'],
    origin: 'https://www.lamoda.ru',
    searchUrl: (q) => `https://www.lamoda.ru/catalogsearch/result/?q=${q}`,
    isProductPage: (url) => /\/p\/[a-z0-9_-]+\//i.test(url),
    isSerp: (_url, path) => /catalogsearch/i.test(path) || /\/search/i.test(path),
    extractArticle: (url) => url.match(/\/p\/([a-z0-9_-]+)/i)?.[1] ?? '',
    serpProductHref: /\/p\/[a-z0-9_-]+\//i,
    serpTabPatterns: ['*://*.lamoda.ru/catalogsearch*', '*://*.lamoda.ru/*search*'],
    serpPollMs: 8_000,
    urlPlaceholder: 'https://www.lamoda.ru/p/...',
  },
];

const BY_ID = Object.fromEntries(TAB_SEARCH_ADAPTERS.map((a) => [a.id, a])) as Partial<
  Record<MarketplaceId, TabSearchAdapterConfig>
>;

export function getTabSearchAdapter(id: MarketplaceId): TabSearchAdapterConfig | undefined {
  return BY_ID[id];
}

export function isTabSearchMarketplace(id: MarketplaceId): boolean {
  return BY_ID[id] != null;
}

/**
 * Generic JSON-LD/DOM card + SERP.
 * Megamarket, AliExpress, and M.Video use dedicated parsers (card + SERP).
 */
export function isGenericCardMarketplace(id: MarketplaceId): boolean {
  return (
    isTabSearchMarketplace(id) &&
    id !== 'megamarket' &&
    id !== 'aliexpress' &&
    id !== 'mvideo'
  );
}

export const TEST_MARKETPLACE_IDS = [
  'dns',
  'citilink',
  'lamoda',
] as const satisfies readonly MarketplaceId[];

export type TestMarketplaceId = (typeof TEST_MARKETPLACE_IDS)[number];

/** Legacy storage id → current MarketplaceId */
export function migrateLegacyMarketplaceId(raw: string): MarketplaceId | null {
  if (raw === 'eldorado') return 'mvideo';
  return isMarketplaceIdSafe(raw) ? (raw as MarketplaceId) : null;
}

function isMarketplaceIdSafe(value: string): boolean {
  return (
    value === 'wildberries' ||
    value === 'ozon' ||
    value === 'yandex_market' ||
    value === 'megamarket' ||
    value === 'aliexpress' ||
    value === 'mvideo' ||
    value === 'dns' ||
    value === 'citilink' ||
    value === 'lamoda'
  );
}