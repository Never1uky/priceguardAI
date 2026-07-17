/**
 * Партнёрские (реферальные) параметры — chrome.storage.local.
 */

export interface ReferralSettings {
  /** Wildberries: query-параметр partner */
  wildberriesPartnerId: string;
  /** Ozon: partner + utm_campaign */
  ozonTag: string;
  /** Яндекс.Маркет: query-параметр clid */
  yandexMarketClid: string;
}

const STORAGE_KEY = 'priceguard_referral_settings';

export const DEFAULT_REFERRAL_SETTINGS: ReferralSettings = {
  wildberriesPartnerId: '',
  ozonTag: '',
  yandexMarketClid: '',
};

let cached: ReferralSettings | null = null;

export function getReferralSettingsSync(): ReferralSettings {
  return cached ?? DEFAULT_REFERRAL_SETTINGS;
}

export async function loadReferralSettings(force = false): Promise<ReferralSettings> {
  if (cached && !force) return cached;

  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const raw = stored[STORAGE_KEY] as Partial<ReferralSettings> | undefined;

  cached = {
    wildberriesPartnerId: raw?.wildberriesPartnerId?.trim() ?? '',
    ozonTag: raw?.ozonTag?.trim() ?? '',
    yandexMarketClid: raw?.yandexMarketClid?.trim() ?? '',
  };

  return cached;
}

export async function saveReferralSettings(
  patch: Partial<ReferralSettings>,
): Promise<ReferralSettings> {
  const current = await loadReferralSettings();
  const next: ReferralSettings = {
    wildberriesPartnerId: (patch.wildberriesPartnerId ?? current.wildberriesPartnerId).trim(),
    ozonTag: (patch.ozonTag ?? current.ozonTag).trim(),
    yandexMarketClid: (patch.yandexMarketClid ?? current.yandexMarketClid).trim(),
  };

  await chrome.storage.local.set({ [STORAGE_KEY]: next });
  cached = next;
  return next;
}

/** Есть ли хотя бы один настроенный партнёрский ID */
export function hasReferralConfigured(settings: ReferralSettings): boolean {
  return Boolean(
    settings.wildberriesPartnerId || settings.ozonTag || settings.yandexMarketClid,
  );
}
