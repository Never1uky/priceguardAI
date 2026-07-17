import { getPriceAlertSettings, type PriceAlertSettings } from '@/lib/compare-price-alerts';
import {
  showCompareCheaperElsewhereNotification,
  showComparePriceDropNotification,
  showPriceDropNotification,
  showTargetPriceNotification,
} from '@/lib/notifications';
import { areNotificationsEnabledForProduct } from '@/lib/notification-settings';
import {
  buildCheaperElsewhereTelegramMessage,
  buildComparePriceDropTelegramMessage,
  openOnMarketplaceButtonText,
} from '@/lib/telegram-alert-messages';
import { sendTelegramPriceAlert } from '@/lib/telegram-price-alert';
import { COMPARISON_MARKETPLACE_LABELS } from '@/types/comparison';
import type { Marketplace } from '@/types/product';
import type { Product } from '@/types/product';

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

function marketplaceLabel(marketplace: Marketplace): string {
  return (
    COMPARISON_MARKETPLACE_LABELS[marketplace as keyof typeof COMPARISON_MARKETPLACE_LABELS] ??
    marketplace
  );
}

/** Падение цены отслеживаемого товара */
export async function dispatchPriceDropAlert(
  product: Product,
  previousPrice: number,
): Promise<void> {
  const settings = await getPriceAlertSettings();
  if (!settings.notificationsEnabled) return;
  if (!(await areNotificationsEnabledForProduct(product.id))) return;
  if (!isSignificantDrop(previousPrice, product.price, settings)) return;

  await showPriceDropNotification(product, previousPrice);

  if (settings.telegramEnabled && settings.telegramChatId.trim()) {
    void sendTelegramPriceAlert({
      chatId: settings.telegramChatId.trim(),
      type: 'price_drop',
      title: product.title,
      oldPrice: previousPrice,
      newPrice: product.price,
      url: product.url,
      marketplace: product.marketplace,
    });
  }
}

/** Достигнута целевая цена */
export async function dispatchTargetPriceAlert(
  product: Product,
  targetPrice: number,
): Promise<void> {
  const settings = await getPriceAlertSettings();
  if (!settings.notificationsEnabled) return;
  if (!(await areNotificationsEnabledForProduct(product.id))) return;

  await showTargetPriceNotification(product, targetPrice);

  if (settings.telegramEnabled && settings.telegramChatId.trim()) {
    void sendTelegramPriceAlert({
      chatId: settings.telegramChatId.trim(),
      type: 'target_price',
      title: product.title,
      newPrice: product.price,
      targetPrice,
      url: product.url,
      marketplace: product.marketplace,
    });
  }
}

/** Падение цены на той же площадке в сравнении */
export async function dispatchComparePriceDropAlert(
  productTitle: string,
  marketplace: Marketplace,
  previousPrice: number,
  newPrice: number,
  url: string,
): Promise<void> {
  const settings = await getPriceAlertSettings();
  if (!settings.notificationsEnabled || !settings.compareAlerts) return;
  if (!isSignificantDrop(previousPrice, newPrice, settings)) return;

  const label = marketplaceLabel(marketplace);

  await showComparePriceDropNotification(
    productTitle,
    label,
    previousPrice,
    newPrice,
    url,
    marketplace,
  );

  if (settings.telegramEnabled && settings.telegramChatId.trim()) {
    const message = buildComparePriceDropTelegramMessage({
      title: productTitle,
      oldPrice: previousPrice,
      newPrice,
      marketplace,
    });
    void sendTelegramPriceAlert({
      chatId: settings.telegramChatId.trim(),
      // generic + готовый текст — не путаем с трекинговым «Цена упала!»
      type: 'generic',
      message,
      title: productTitle,
      oldPrice: previousPrice,
      newPrice,
      url,
      marketplace,
      buttonText: openOnMarketplaceButtonText(marketplace),
    });
  }
}

/** В сравнении нашли значимо дешевле на другой площадке */
export async function dispatchCheaperElsewhereAlert(input: {
  productTitle: string;
  sourceMarketplace: Marketplace;
  sourcePrice: number;
  cheaperMarketplace: Marketplace;
  cheaperPrice: number;
  url: string;
}): Promise<void> {
  const settings = await getPriceAlertSettings();
  if (!settings.notificationsEnabled || !settings.compareAlerts) return;
  if (!isSignificantDrop(input.sourcePrice, input.cheaperPrice, settings)) return;

  const sourceLabel = marketplaceLabel(input.sourceMarketplace);
  const cheaperLabel = marketplaceLabel(input.cheaperMarketplace);

  await showCompareCheaperElsewhereNotification(
    input.productTitle,
    sourceLabel,
    input.sourcePrice,
    cheaperLabel,
    input.cheaperPrice,
    input.url,
    input.cheaperMarketplace,
  );

  if (settings.telegramEnabled && settings.telegramChatId.trim()) {
    const message = buildCheaperElsewhereTelegramMessage({
      title: input.productTitle,
      sourceMarketplace: input.sourceMarketplace,
      sourcePrice: input.sourcePrice,
      cheaperMarketplace: input.cheaperMarketplace,
      cheaperPrice: input.cheaperPrice,
    });
    void sendTelegramPriceAlert({
      chatId: settings.telegramChatId.trim(),
      type: 'cheaper_elsewhere',
      message,
      title: input.productTitle,
      oldPrice: input.sourcePrice,
      newPrice: input.cheaperPrice,
      sourceMarketplace: input.sourceMarketplace,
      sourcePrice: input.sourcePrice,
      marketplace: input.cheaperMarketplace,
      url: input.url,
      buttonText: openOnMarketplaceButtonText(input.cheaperMarketplace),
    });
  }
}
