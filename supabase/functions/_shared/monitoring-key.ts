/**
 * Canonical monitoring / dedup key for Telegram price cron.
 *
 * Prefer: marketplace + bare product_id
 * Fallback: marketplace + id extracted from product URL
 * Never: title
 *
 * Example: ozon + 12345 → one monitoring target for all subscribers.
 */

import { productKey, stripProductIdPrefix } from './product-id.ts';
import { extractProductId, type Marketplace } from './product-url.ts';

const CORE_MARKETPLACES: ReadonlySet<string> = new Set([
  'wildberries',
  'ozon',
  'yandex_market',
]);

export function isCoreMonitoringMarketplace(mp: string): mp is Marketplace {
  return CORE_MARKETPLACES.has(mp);
}

export type MonitoringKeySource = 'product_id' | 'canonical_url';

export interface MonitoringKeyInput {
  marketplace: string;
  productId?: string | null;
  productUrl?: string | null;
  /** Explicitly ignored — title must never form a monitoring key */
  title?: string | null;
}

export interface ResolvedMonitoringKey {
  /** `marketplace:bareProductId` */
  key: string;
  marketplace: Marketplace;
  /** Bare article for fetch / cache */
  productId: string;
  source: MonitoringKeySource;
}

function isStableBareId(id: string): boolean {
  const a = id.trim();
  if (!a) return false;
  if (/^\d{4,}$/.test(a)) return true;
  return a.length >= 6;
}

/**
 * Resolve canonical monitoring identity.
 * Returns null when neither product_id nor URL yields a stable SKU.
 * `title` is intentionally unused.
 */
export function resolveMonitoringKey(
  input: MonitoringKeyInput,
): ResolvedMonitoringKey | null {
  void input.title;
  const mp = String(input.marketplace ?? '');
  if (!isCoreMonitoringMarketplace(mp)) return null;

  const fromId = stripProductIdPrefix(mp, String(input.productId ?? ''));
  if (isStableBareId(fromId)) {
    return {
      key: productKey(mp, fromId),
      marketplace: mp,
      productId: fromId,
      source: 'product_id',
    };
  }

  const url = String(input.productUrl ?? '').trim();
  if (url.startsWith('http')) {
    const fromUrl = extractProductId(url, mp);
    const bareUrl = stripProductIdPrefix(mp, fromUrl);
    if (isStableBareId(bareUrl)) {
      return {
        key: productKey(mp, bareUrl),
        marketplace: mp,
        productId: bareUrl,
        source: 'canonical_url',
      };
    }
  }

  return null;
}
