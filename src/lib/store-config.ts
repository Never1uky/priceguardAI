/**
 * Multi-store listing metadata (Chrome / Edge / Yandex).
 *
 * Rules:
 * - Only real IDs/URLs — never invent Edge/Yandex values.
 * - Unknown stores use `null` (safe for “skip” / “not published yet”).
 * - Primary install/review for product UX remains Chrome until others are filled.
 * - Does not affect MV3 build / permissions / marketplace logic.
 */

export type StoreChannel = 'chrome' | 'edge' | 'yandex';

export type StoreListingConfig = {
  /** Public store listing URL, or null if not published yet */
  storeUrl: string | null;
  /** Browser-assigned extension id, or null if unknown */
  extensionId: string | null;
  /** Reviews / rating page, or null */
  reviewUrl: string | null;
};

/**
 * Single source of truth inside the extension package.
 * Keep Deno Telegram copy (`supabase/functions/_shared/telegram.ts`) in sync manually
 * until a shared package exists — do not point bots at null URLs.
 */
export const STORE_CONFIG: Record<StoreChannel, StoreListingConfig> = {
  chrome: {
    storeUrl:
      'https://chromewebstore.google.com/detail/priceguard-ai/ipaichogganccpnapdgkjldplllnjlpf',
    extensionId: 'ipaichogganccpnapdgkjldplllnjlpf',
    reviewUrl:
      'https://chromewebstore.google.com/detail/priceguard-ai/ipaichogganccpnapdgkjldplllnjlpf/reviews',
  },
  edge: {
    storeUrl: null,
    extensionId: null,
    reviewUrl: null,
  },
  yandex: {
    storeUrl: null,
    extensionId: null,
    reviewUrl: null,
  },
};

/** Channel used for install / review CTAs until Edge/Yandex are published. */
export const PRIMARY_STORE_CHANNEL: StoreChannel = 'chrome';

export function getStoreListing(channel: StoreChannel): StoreListingConfig {
  return STORE_CONFIG[channel];
}

/** Install URL for buttons — always a real URL (falls back to Chrome). */
export function getPrimaryInstallUrl(): string {
  const primary = STORE_CONFIG[PRIMARY_STORE_CHANNEL].storeUrl;
  const chrome = STORE_CONFIG.chrome.storeUrl;
  const url = primary ?? chrome;
  if (!url) {
    throw new Error('STORE_CONFIG.chrome.storeUrl is required');
  }
  return url;
}

/** Review URL for buttons — always a real URL (falls back to Chrome). */
export function getPrimaryReviewUrl(): string {
  const primary = STORE_CONFIG[PRIMARY_STORE_CHANNEL].reviewUrl;
  const chrome = STORE_CONFIG.chrome.reviewUrl;
  const url = primary ?? chrome;
  if (!url) {
    throw new Error('STORE_CONFIG.chrome.reviewUrl is required');
  }
  return url;
}

/**
 * Extension IDs known to be published — for SEO multi-sendMessage (caller-side).
 * Never includes null / placeholder IDs.
 * Keep in sync with priceguard-seo `SITE.extensionIds` (see docs/audits/PHASE4_SEO_BRIDGE.md).
 */
export function listKnownExtensionIds(): string[] {
  const ids: string[] = [];
  for (const channel of ['chrome', 'edge', 'yandex'] as const) {
    const id = STORE_CONFIG[channel].extensionId;
    if (typeof id === 'string' && id.length > 0) ids.push(id);
  }
  return ids;
}

import { detectBrowserLabelFromUa, readNavigatorUserAgent } from '@/lib/browser-label';

/**
 * Map UA → store channel. Unknown → chrome (CWS install fallback).
 * Detection tokens shared with telemetry via browser-label.ts.
 */
export function detectStoreChannelFromUa(ua?: string | null): StoreChannel {
  const label = detectBrowserLabelFromUa(ua ?? readNavigatorUserAgent());
  if (label === 'edge') return 'edge';
  if (label === 'yandex') return 'yandex';
  return 'chrome';
}

function urlOrChromeFallback(
  channel: StoreChannel,
  field: 'storeUrl' | 'reviewUrl',
): string {
  const preferred = STORE_CONFIG[channel][field];
  if (preferred) return preferred;
  const chrome = STORE_CONFIG.chrome[field];
  if (!chrome) {
    throw new Error(`STORE_CONFIG.chrome.${field} is required`);
  }
  return chrome;
}

/** Install listing for this UA; falls back to CWS when Edge/Yandex URL is null. */
export function resolveInstallUrlForUa(ua?: string | null): string {
  return urlOrChromeFallback(detectStoreChannelFromUa(ua), 'storeUrl');
}

/** Review listing for this UA; falls back to CWS when Edge/Yandex URL is null. */
export function resolveReviewUrlForUa(ua?: string | null): string {
  return urlOrChromeFallback(detectStoreChannelFromUa(ua), 'reviewUrl');
}
