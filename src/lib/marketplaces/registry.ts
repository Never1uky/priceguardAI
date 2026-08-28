/**
 * Single source of truth for comparison / search marketplaces.
 * Add a new MP here first; then adapter + detect/URL switches.
 */

export type MarketplaceId =
  | 'wildberries'
  | 'ozon'
  | 'yandex_market'
  | 'megamarket'
  | 'aliexpress'
  | 'mvideo'
  | 'dns'
  | 'citilink'
  | 'lamoda';

/** Cost profile for compare: API-first vs tab/SERP-heavy. */
export type MarketplaceCostTier = 'api' | 'tab';

export interface MarketplaceCapabilities {
  search: boolean;
  card: boolean;
  reviews: boolean;
  /**
   * `api` — core MPs with HTTP APIs (and optional Premium Scrappey on card).
   * `tab` — HiddenBrowser / visible SERP only (no Scrappey).
   */
  costTier: MarketplaceCostTier;
}

export interface MarketplaceRegistryEntry {
  id: MarketplaceId;
  name: string;
  shortName: string;
  /** Included in default «Где искать» for existing + new users */
  enabledByDefault: boolean;
  /** Shown in settings / usable in compare when true */
  supported: boolean;
  capabilities: MarketplaceCapabilities;
  /** Badge UI variant (existing Badge variants + default) */
  badgeVariant: 'wildberries' | 'ozon' | 'yandex' | 'default';
}

const TEST_MP_CAPS: MarketplaceCapabilities = {
  search: true,
  card: true,
  reviews: false,
  costTier: 'tab',
};

export const MARKETPLACES: readonly MarketplaceRegistryEntry[] = [
  {
    id: 'wildberries',
    name: 'Wildberries',
    shortName: 'WB',
    enabledByDefault: true,
    supported: true,
    capabilities: { search: true, card: true, reviews: true, costTier: 'api' },
    badgeVariant: 'wildberries',
  },
  {
    id: 'ozon',
    name: 'Ozon',
    shortName: 'Ozon',
    enabledByDefault: true,
    supported: true,
    capabilities: { search: true, card: true, reviews: true, costTier: 'api' },
    badgeVariant: 'ozon',
  },
  {
    id: 'yandex_market',
    name: 'Яндекс.Маркет',
    shortName: 'Я.Маркет',
    enabledByDefault: true,
    supported: true,
    capabilities: { search: true, card: true, reviews: true, costTier: 'api' },
    badgeVariant: 'yandex',
  },
  {
    id: 'megamarket',
    name: 'Мегамаркет',
    shortName: 'Мега',
    enabledByDefault: true,
    supported: true,
    capabilities: { search: true, card: true, reviews: false, costTier: 'tab' },
    badgeVariant: 'default',
  },
  {
    id: 'aliexpress',
    name: 'AliExpress',
    shortName: 'Ali',
    enabledByDefault: true,
    supported: true,
    capabilities: { search: true, card: true, reviews: true, costTier: 'tab' },
    badgeVariant: 'default',
  },
  {
    id: 'mvideo',
    name: 'М.Видео',
    shortName: 'М.Видео',
    enabledByDefault: true,
    supported: true,
    capabilities: { search: true, card: true, reviews: false, costTier: 'tab' },
    badgeVariant: 'default',
  },
  {
    id: 'dns',
    name: 'DNS',
    shortName: 'DNS',
    enabledByDefault: false,
    supported: true,
    capabilities: TEST_MP_CAPS,
    badgeVariant: 'default',
  },
  {
    id: 'citilink',
    name: 'Ситилинк',
    shortName: 'Ситилинк',
    enabledByDefault: false,
    supported: true,
    capabilities: TEST_MP_CAPS,
    badgeVariant: 'default',
  },
  {
    id: 'lamoda',
    name: 'Lamoda',
    shortName: 'Lamoda',
    enabledByDefault: false,
    supported: true,
    capabilities: TEST_MP_CAPS,
    badgeVariant: 'default',
  },
] as const;

export const COMPARISON_MARKETPLACE_IDS: MarketplaceId[] = MARKETPLACES.map((m) => m.id);

/** Legacy default trio — used for migration / empty config fallback */
export const DEFAULT_SEARCH_MARKETPLACE_IDS: MarketplaceId[] = MARKETPLACES.filter(
  (m) => m.enabledByDefault,
).map((m) => m.id);

export function getMarketplaceEntry(id: string): MarketplaceRegistryEntry | undefined {
  return MARKETPLACES.find((m) => m.id === id);
}

export function isMarketplaceId(value: unknown): value is MarketplaceId {
  return typeof value === 'string' && MARKETPLACES.some((m) => m.id === value);
}

export function marketplaceLabel(id: MarketplaceId): string {
  return getMarketplaceEntry(id)?.name ?? id;
}

export function marketplaceShortLabel(id: MarketplaceId): string {
  return getMarketplaceEntry(id)?.shortName ?? id;
}

export function marketplaceCostTier(id: MarketplaceId): MarketplaceCostTier {
  return getMarketplaceEntry(id)?.capabilities.costTier ?? 'tab';
}

export function isTabCostMarketplace(id: MarketplaceId): boolean {
  return marketplaceCostTier(id) === 'tab';
}

/**
 * Prices updated by Telegram / update-prices cron.
 * Megamarket / AliExpress / M.Video (and test MPs) are client-tracked only — never skip client
 * refresh because cron is “on”.
 */
export function isCronPriceMonitoredMarketplace(id: MarketplaceId | string): boolean {
  return id === 'wildberries' || id === 'ozon' || id === 'yandex_market';
}

function labelsFromRegistry(pick: (m: MarketplaceRegistryEntry) => string): Record<MarketplaceId, string> {
  const out = {} as Record<MarketplaceId, string>;
  for (const m of MARKETPLACES) out[m.id] = pick(m);
  return out;
}

export const COMPARISON_MARKETPLACE_LABELS: Record<MarketplaceId, string> = labelsFromRegistry(
  (m) => m.name,
);

export const COMPARISON_MARKETPLACE_SHORT_LABELS: Record<MarketplaceId, string> = labelsFromRegistry(
  (m) => m.shortName,
);
