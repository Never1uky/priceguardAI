import { offersFromCompareProduct, isOfferWithPrice } from '@/lib/compare-offers';
import {
  dispatchCheaperElsewhereAlert,
  dispatchComparePriceDropAlert,
} from '@/lib/price-alert-dispatch';
import type { CompareProduct, MarketplaceOffer } from '@/types/comparison';
import type { Marketplace } from '@/types/product';

const SETTINGS_KEY = 'priceguard_price_alert_settings';

export interface PriceAlertSettings {
  /** Глобальный выключатель уведомлений о падении цены и целевой цене */
  notificationsEnabled: boolean;
  /** Минимальное падение в рублях для уведомления */
  minDropRub: number;
  /** Минимальное падение в процентах (0 = любое) */
  minDropPercent: number;
  /** Уведомлять о снижении цен в сравнении */
  compareAlerts: boolean;
  /** Дублировать уведомления в Telegram */
  telegramEnabled: boolean;
  /** Chat ID пользователя (@userinfobot) */
  telegramChatId: string;
}

const DEFAULT_SETTINGS: PriceAlertSettings = {
  notificationsEnabled: true,
  minDropRub: 100,
  minDropPercent: 1,
  compareAlerts: true,
  telegramEnabled: false,
  telegramChatId: '',
};

export async function getPriceAlertSettings(): Promise<PriceAlertSettings> {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(stored[SETTINGS_KEY] as Partial<PriceAlertSettings> | undefined) };
}

/** Записать настройки локально без push в облако (для restore / избежания циклов). */
export async function applyPriceAlertSettingsLocal(
  patch: Partial<PriceAlertSettings>,
): Promise<PriceAlertSettings> {
  const current = await getPriceAlertSettings();
  const next = { ...current, ...patch };
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

function isSignificantDrop(
  previousPrice: number,
  newPrice: number,
  settings: PriceAlertSettings,
): boolean {
  if (newPrice >= previousPrice) return false;

  const drop = previousPrice - newPrice;
  const percent = (drop / previousPrice) * 100;

  if (settings.minDropPercent > 0 && percent < settings.minDropPercent) return false;
  if (drop < settings.minDropRub) return false;

  return true;
}

function resolveSourcePrice(
  product: CompareProduct,
  oldOffers: MarketplaceOffer[],
  newOffers: MarketplaceOffer[],
): number | null {
  const fromNew = newOffers.find((o) => o.marketplace === product.sourceMarketplace);
  if (isOfferWithPrice(fromNew)) return fromNew!.price!;

  const fromOld = oldOffers.find((o) => o.marketplace === product.sourceMarketplace);
  if (isOfferWithPrice(fromOld)) return fromOld!.price!;

  if (isOfferWithPrice(product.sourceOffer)) return product.sourceOffer!.price!;

  return null;
}

export async function checkComparePriceDrops(
  product: CompareProduct,
  newOffers: MarketplaceOffer[],
): Promise<void> {
  const settings = await getPriceAlertSettings();
  if (!settings.notificationsEnabled || !settings.compareAlerts) return;

  const oldOffers = offersFromCompareProduct(product);
  const title = product.title !== 'Товар' ? product.title : 'Товар в сравнении';
  const sourceMarketplace = product.sourceMarketplace as Marketplace;
  const sourcePrice = resolveSourcePrice(product, oldOffers, newOffers);

  // 1) Падение цены на той же площадке (в т.ч. на источнике)
  for (const newOffer of newOffers) {
    if (!isOfferWithPrice(newOffer)) continue;

    const oldOffer = oldOffers.find((o) => o.marketplace === newOffer.marketplace);
    if (!isOfferWithPrice(oldOffer)) continue;

    const previousPrice = oldOffer!.price!;
    const newPrice = newOffer.price!;

    if (!isSignificantDrop(previousPrice, newPrice, settings)) continue;

    await dispatchComparePriceDropAlert(
      title,
      newOffer.marketplace as Marketplace,
      previousPrice,
      newPrice,
      newOffer.url,
    );
  }

  // 2) Нашли / улучшили оффер дешевле источника на другой площадке
  if (sourcePrice == null || sourcePrice <= 0) return;

  for (const newOffer of newOffers) {
    if (!isOfferWithPrice(newOffer)) continue;
    if (newOffer.marketplace === sourceMarketplace) continue;
    if (!newOffer.url || /search\?/i.test(newOffer.url)) continue;

    const cheaperPrice = newOffer.price!;
    if (!isSignificantDrop(sourcePrice, cheaperPrice, settings)) continue;

    const oldOffer = oldOffers.find((o) => o.marketplace === newOffer.marketplace);
    const isNewFind = !isOfferWithPrice(oldOffer);
    const improvedOnMp =
      isOfferWithPrice(oldOffer) && cheaperPrice < (oldOffer!.price as number);

    if (!isNewFind && !improvedOnMp) continue;

    // Уже оповестили о same-MP drop на этой площадке выше — для improvedOnMp
    // cheaper_elsewhere всё равно полезен (сравнение с источником + ссылка).
    // Чтобы не дублировать два алерта на один refresh при improvedOnMp:
    // если уже был same-MP significant drop — пропускаем cheaper_elsewhere.
    if (
      improvedOnMp &&
      isOfferWithPrice(oldOffer) &&
      isSignificantDrop(oldOffer!.price!, cheaperPrice, settings)
    ) {
      continue;
    }

    await dispatchCheaperElsewhereAlert({
      productTitle: title,
      sourceMarketplace,
      sourcePrice,
      cheaperMarketplace: newOffer.marketplace as Marketplace,
      cheaperPrice,
      url: newOffer.url,
    });
  }
}
