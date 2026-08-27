/**
 * Единая нормализация product_id для product_cache / mapping / Telegram.
 * Extension часто пишет `wb-{nmId}` / `ozon-{id}`; Telegram / tracked — голый артикул.
 */

import type { Marketplace } from './product-url.ts';

const PREFIX: Record<Marketplace, string> = {
  wildberries: 'wb-',
  ozon: 'ozon-',
  yandex_market: 'ym-',
  megamarket: 'mm-',
  aliexpress: 'ae-',
};

/** Голый артикул без префикса marketplace. */
export function stripProductIdPrefix(
  marketplace: Marketplace,
  productId: string,
): string {
  const raw = productId.trim();
  if (!raw) return '';
  const prefix = PREFIX[marketplace];
  if (raw.toLowerCase().startsWith(prefix)) {
    return raw.slice(prefix.length);
  }
  // ym- / yandex- legacy
  if (marketplace === 'yandex_market' && /^yandex[_-]?/i.test(raw)) {
    return raw.replace(/^yandex[_-]?/i, '');
  }
  if (marketplace === 'megamarket') {
    const stripped = raw.replace(/^(megamarket:|mega-)/i, '');
    const digits = stripped.replace(/\D/g, '');
    return digits.length >= 6 ? digits : stripped;
  }
  if (marketplace === 'aliexpress') {
    const stripped = raw.replace(/^(aliexpress:|ali-)/i, '');
    const digits = stripped.replace(/\D/g, '');
    return digits.length >= 8 ? digits : stripped;
  }
  return raw;
}

/** Канонический id как в extension Product.id */
export function toPrefixedProductId(
  marketplace: Marketplace,
  productId: string,
): string {
  const bare = stripProductIdPrefix(marketplace, productId);
  if (!bare) return '';
  return `${PREFIX[marketplace]}${bare}`;
}

/**
 * Кандидаты для lookup в product_cache / cross_market_mapping
 * (порядок: как пишет extension, затем bare).
 */
export function productIdLookupCandidates(
  marketplace: Marketplace,
  productId: string,
): string[] {
  const bare = stripProductIdPrefix(marketplace, productId);
  if (!bare) return [];
  const prefixed = toPrefixedProductId(marketplace, bare);
  return bare === prefixed ? [bare] : [prefixed, bare];
}

export function productKey(marketplace: Marketplace, productId: string): string {
  const bare = stripProductIdPrefix(marketplace, productId);
  return `${marketplace}:${bare}`;
}

export function parseProductKey(
  key: string,
): { marketplace: Marketplace; productId: string } | null {
  const m = key.match(/^(wildberries|ozon|yandex_market|megamarket|aliexpress):(.+)$/);
  if (!m?.[1] || !m[2]) return null;
  return {
    marketplace: m[1] as Marketplace,
    productId: m[2],
  };
}
