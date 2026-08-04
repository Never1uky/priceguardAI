/**
 * Allowlist https marketplace URLs before storage, tabs.create, or <a href>.
 */

import type { Marketplace } from '@/types/product';

const HOST_BY_MARKETPLACE: Record<Marketplace, string[]> = {
  wildberries: ['wildberries.ru'],
  ozon: ['ozon.ru'],
  yandex_market: ['market.yandex.ru', 'ya.ru'],
};

const ALL_SUFFIXES = [
  'wildberries.ru',
  'ozon.ru',
  'market.yandex.ru',
  'ya.ru',
];

function hostAllowed(host: string, suffixes: string[]): boolean {
  const h = host.toLowerCase();
  return suffixes.some((suffix) => h === suffix || h.endsWith(`.${suffix}`));
}

/** True if URL is https and host is an allowed marketplace. */
export function isSafeMarketplaceUrl(
  raw: string | null | undefined,
  marketplace?: Marketplace | null,
): boolean {
  if (!raw || typeof raw !== 'string') return false;
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  const suffixes = marketplace ? HOST_BY_MARKETPLACE[marketplace] : ALL_SUFFIXES;
  return hostAllowed(parsed.hostname, suffixes);
}

/** Returns the URL if safe, otherwise empty string (safe for href fallback). */
export function safeMarketplaceHref(
  raw: string | null | undefined,
  marketplace?: Marketplace | null,
): string {
  return isSafeMarketplaceUrl(raw, marketplace) ? String(raw).trim() : '';
}
