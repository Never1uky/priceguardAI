/**
 * Public store / channel links for the extension UI.
 * Store listing fields live in `store-config.ts` (Chrome filled; Edge/Yandex null until publish).
 */

import {
  getPrimaryInstallUrl,
  getPrimaryReviewUrl,
  resolveInstallUrlForUa,
  resolveReviewUrlForUa,
} from '@/lib/store-config';

/** Публичная страница расширения (сейчас = Chrome Web Store) — static CWS primary */
export const CHROME_WEB_STORE_URL = getPrimaryInstallUrl();

/** Страница отзывов (сейчас = CWS /reviews) — static CWS primary */
export const CHROME_WEB_STORE_REVIEWS_URL = getPrimaryReviewUrl();

/** Browser-aware install URL (CWS fallback while Edge/Yandex URLs are null). */
export function getInstallUrlForCurrentBrowser(): string {
  return resolveInstallUrlForUa();
}

/** Browser-aware review URL (CWS fallback while Edge/Yandex URLs are null). */
export function getReviewUrlForCurrentBrowser(): string {
  return resolveReviewUrlForUa();
}

/** Telegram-канал с разборами карточек (не алерты о цене) */
export const TELEGRAM_CHANNEL_URL = 'https://t.me/priceguard_ai';

/** Подпись кнопки/ссылки на канал — везде одинаковая */
export const TELEGRAM_CHANNEL_LINK_LABEL = 'Канал с разборами';
