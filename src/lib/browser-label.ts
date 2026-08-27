/**
 * Coarse browser label for telemetry / store routing.
 * Derives only an enum from UA tokens — never stores or sends the raw UA.
 *
 * Real Yandex Browser desktop UA (Chromium-based) includes both Chrome/ and YaBrowser/:
 *   ... Chrome/150.0.0.0 YaBrowser/26.6.0.1845 Yowser/2.5 Safari/537.36
 * Token `YaBrowser/` is present on desktop + mobile; `Yowser/` is common on desktop.
 */

export type BrowserLabel = 'chrome' | 'edge' | 'yandex' | 'unknown';

/**
 * Order matters: Edge and Yandex also contain "Chrome/".
 * - Edg/ → Microsoft Edge
 * - YaBrowser/ | Yowser/ → Yandex Browser (not plain Chrome)
 * - Chrome/ → Google Chrome / other Chromium without Edge/Yandex tokens
 * - else → unknown
 */
export function detectBrowserLabelFromUa(ua?: string | null): BrowserLabel {
  const s = ua ?? '';
  if (!s) return 'unknown';
  if (/Edg\//i.test(s)) return 'edge';
  if (/YaBrowser\//i.test(s) || /Yowser\//i.test(s)) return 'yandex';
  if (/Chrome\//i.test(s) || /Chromium\//i.test(s)) return 'chrome';
  return 'unknown';
}

/** navigator.userAgent when available; does not throw. */
export function readNavigatorUserAgent(): string {
  try {
    return typeof navigator !== 'undefined' ? navigator.userAgent : '';
  } catch {
    return '';
  }
}
