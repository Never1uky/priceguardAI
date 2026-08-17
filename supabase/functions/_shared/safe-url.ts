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

/** Canonical t.me usernames we may put on bot buttons. */
const ALLOWED_TELEGRAM_CANONICAL: Record<string, string> = {
  priceguard_ai: 'priceguard_ai',
  priceguard_supportbot: 'priceguard_supportbot',
  priceguardalertsbot: 'PriceGuardAlertsBot',
  pricealertbot: 'pricealertbot',
};

/** Allowlisted t.me links for bot/channel buttons (not arbitrary URLs). */
export function sanitizeTelegramPublicUrl(
  raw: string | null | undefined,
): string | undefined {
  if (!raw) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(String(raw).trim());
  } catch {
    return undefined;
  }
  if (parsed.protocol !== 'https:') return undefined;
  const host = parsed.hostname.toLowerCase();
  if (host !== 't.me' && host !== 'telegram.me') return undefined;
  const path = parsed.pathname.replace(/^\//, '').split('/')[0] ?? '';
  if (!path) return undefined;
  const canonical = ALLOWED_TELEGRAM_CANONICAL[path.toLowerCase()];
  if (!canonical) return undefined;
  return `https://t.me/${canonical}`;
}

/** Marketplace product URL or allowlisted Telegram public URL. */
export function sanitizeAlertButtonUrl(
  raw: string | null | undefined,
): string | undefined {
  return sanitizeMarketplaceButtonUrl(raw) ?? sanitizeTelegramPublicUrl(raw);
}
