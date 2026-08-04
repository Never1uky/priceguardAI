/**
 * Allowlist https marketplace product/search URLs for Telegram buttons and links.
 */

const ALLOWED_HOST_SUFFIXES = [
  'wildberries.ru',
  'ozon.ru',
  'market.yandex.ru',
  'ya.ru',
];

export function isAllowedMarketplaceHttpsUrl(raw: string | null | undefined): boolean {
  if (!raw || typeof raw !== 'string') return false;
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  const host = parsed.hostname.toLowerCase();
  return ALLOWED_HOST_SUFFIXES.some(
    (suffix) => host === suffix || host.endsWith(`.${suffix}`),
  );
}

/** Returns sanitized URL or undefined if not allowlisted. */
export function sanitizeMarketplaceButtonUrl(
  raw: string | null | undefined,
): string | undefined {
  if (!raw) return undefined;
  const trimmed = String(raw).trim().slice(0, 2000);
  return isAllowedMarketplaceHttpsUrl(trimmed) ? trimmed : undefined;
}
