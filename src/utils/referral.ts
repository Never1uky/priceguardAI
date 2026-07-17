/**
 * Партнёрские (реферальные) ссылки для маркетплейсов.
 *
 * Порядок: нормализация карточки (offerLinkUrl) → добавление query-параметров.
 * В storage и sync сохраняются канонические URL без партнёрских параметров.
 */

import {
  DEFAULT_REFERRAL_SETTINGS,
  getReferralSettingsSync,
  loadReferralSettings,
  type ReferralSettings,
} from '@/lib/referral-settings';
import type { Marketplace } from '@/types/product';
import { detectMarketplace } from '@/utils/marketplace';
import { offerLinkUrl } from '@/utils/product-url';

/**
 * Добавить реферальные query-параметры к уже нормализованному URL.
 *
 * Wildberries: ?partner={partner_id}
 * Ozon:        ?partner={tag}&utm_campaign={tag}
 * Я.Маркет:    ?clid={clid}
 */
export function applyReferralParams(
  url: string,
  settings: ReferralSettings = getReferralSettingsSync(),
  marketplace?: Marketplace | null,
): string {
  if (!url?.trim()) return url;

  const mp = marketplace ?? detectMarketplace(url);
  if (!mp) return url;

  try {
    const parsed = new URL(url);

    if (mp === 'wildberries') {
      const partnerId = settings.wildberriesPartnerId.trim();
      if (partnerId) parsed.searchParams.set('partner', partnerId);
    } else if (mp === 'ozon') {
      const tag = settings.ozonTag.trim();
      if (tag) {
        parsed.searchParams.set('partner', tag);
        parsed.searchParams.set('utm_campaign', tag);
      }
    } else if (mp === 'yandex_market') {
      const clid = settings.yandexMarketClid.trim();
      if (clid) parsed.searchParams.set('clid', clid);
    }

    return parsed.toString();
  } catch {
    return url;
  }
}

/**
 * Главная функция: каноническая карточка + реферальные параметры (синхронно, из кэша настроек).
 */
export function makeReferralLink(
  url: string,
  marketplace?: Marketplace | null,
  settings?: ReferralSettings,
): string {
  if (!url?.trim()) return url;

  const resolvedSettings = settings ?? getReferralSettingsSync();
  const mp = marketplace ?? detectMarketplace(url);
  const base = mp ? offerLinkUrl(url, mp) : url.split('#')[0];

  return applyReferralParams(base, resolvedSettings, mp);
}

/** То же, но с подгрузкой настроек из chrome.storage (для background / уведомлений). */
export async function makeReferralLinkAsync(
  url: string,
  marketplace?: Marketplace | null,
): Promise<string> {
  await loadReferralSettings();
  return makeReferralLink(url, marketplace);
}

/** Сброс кэша (тесты). */
export function __resetReferralCacheForTests(): void {
  void loadReferralSettings(true);
}

export { DEFAULT_REFERRAL_SETTINGS };
