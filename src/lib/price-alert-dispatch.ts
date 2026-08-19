import { getPriceAlertSettings, type PriceAlertSettings } from '@/lib/compare-price-alerts';
import {
  showCompareCheaperElsewhereNotification,
  showComparePriceDropNotification,
  showPriceDropNotification,
  showTargetPriceNotification,
} from '@/lib/notifications';
import { areNotificationsEnabledForProduct } from '@/lib/notification-settings';
import {
  assertScrapedPriceIdentity,
  logPriceIdentityReject,
  productsIdentityMatch,
  resolveProductArticle,
  stableProductStorageId,
  type PriceIdentityRef,
} from '@/lib/price-identity';
import {
  buildCheaperElsewhereTelegramMessage,
  openOnMarketplaceButtonText,
} from '@/lib/telegram-alert-messages';
import { sendTelegramPriceAlert } from '@/lib/telegram-price-alert';
import {
  isWithinTelegramGrace,
  logTelegramGraceSkip,
} from '@/lib/telegram-grace';
import { isServerPriceMonitoringActive } from '@/lib/supabase/alert-settings-sync';
import { getTrackedProducts } from '@/lib/storage';
import { COMPARISON_MARKETPLACE_LABELS } from '@/types/comparison';
import type { Marketplace, Product, TrackedProduct } from '@/types/product';
import { toCanonicalProductUrl } from '@/utils/product-url';
import { detectComparisonMarketplace } from '@/utils/comparison-url';

const DROP_NOTIFY_KEY = 'priceguard_last_drop_notify';
const DROP_COOLDOWN_MS = 8 * 60 * 60 * 1000;

function isSignificantDrop(
  previousPrice: number,
  newPrice: number,
  settings: PriceAlertSettings,
): boolean {
  if (newPrice >= previousPrice) return false;
  const drop = previousPrice - newPrice;
  const percent = (drop / previousPrice) * 100;
  const percentPass = settings.minDropPercent <= 0 || percent >= settings.minDropPercent;
  const rubPass = settings.minDropRub <= 0 || drop >= settings.minDropRub;
  return percentPass || rubPass;
}

function marketplaceLabel(marketplace: Marketplace): string {
  return (
    COMPARISON_MARKETPLACE_LABELS[marketplace as keyof typeof COMPARISON_MARKETPLACE_LABELS] ??
    marketplace
  );
}

/**
 * Stable cooldown key across tracked + compare for the same logical product.
 * Prefers bare article (cross-MP), then storage id, then canonical URL.
 * `kind` separates same-MP drop from cheaper-elsewhere so one event can't steal the other.
 */
export function alertDropDedupeKey(
  ref: PriceIdentityRef,
  kind: 'drop' | 'cheaper' = 'drop',
): string {
  const article = resolveProductArticle(ref);
  let base: string;
  if (article) {
    base = `art:${article}`;
  } else {
    const stable = stableProductStorageId(ref);
    if (stable) {
      base = stable;
    } else if (ref.url) {
      try {
        base = `url:${toCanonicalProductUrl(ref.url, ref.marketplace)}`;
      } catch {
        base = `url:${ref.url}`;
      }
    } else {
      base = `id:${ref.id ?? 'unknown'}`;
    }
  }
  return `${kind}:${base}`;
}

/** @internal exported for tests */
export async function shouldSendClientDrop(dedupeKey: string, newPrice: number): Promise<boolean> {
  const stored = await chrome.storage.local.get(DROP_NOTIFY_KEY);
  const map = (stored[DROP_NOTIFY_KEY] as Record<string, { at: number; price: number }> | undefined) ??
    {};
  const prev = map[dedupeKey];
  if (prev && Date.now() - prev.at < DROP_COOLDOWN_MS && newPrice >= prev.price * 0.98) {
    return false;
  }
  map[dedupeKey] = { at: Date.now(), price: newPrice };
  await chrome.storage.local.set({ [DROP_NOTIFY_KEY]: map });
  return true;
}

type AlertProduct = Product & { trackedAt?: number };

/**
 * Alert only for a proven tracked SKU. Message title/url come from tracked row;
 * price comes from the scrape that matched identity.
 */
async function resolveTrackedForAlert(product: Product): Promise<AlertProduct | null> {
  if (!stableProductStorageId(product)) {
    logPriceIdentityReject(null, product, 'unstable_alert_id');
    return null;
  }
  const tracked = await getTrackedProducts();
  const match = tracked.find((item) => productsIdentityMatch(item, product).ok);
  if (!match) {
    logPriceIdentityReject(null, product, 'not_tracked');
    return null;
  }
  const identity = assertScrapedPriceIdentity(match, product);
  if (!identity.ok) return null;
  return {
    ...match,
    price: product.price,
    oldPrice: product.oldPrice ?? match.oldPrice,
    scrapedAt: product.scrapedAt,
    trackedAt: match.trackedAt,
  };
}

function shouldSkipTelegramForTracked(product: AlertProduct): boolean {
  if (!isWithinTelegramGrace(product.trackedAt)) return false;
  logTelegramGraceSkip(product.id, product.trackedAt!);
  return true;
}

/** Fresh «Мои товары» matching this URL — skip TG on compare alerts too. */
async function shouldSkipTelegramForUrl(url: string | undefined): Promise<boolean> {
  if (!url) return false;
  const tracked = await getTrackedProducts();
  const match = tracked.find((item) =>
    productsIdentityMatch(item, {
      marketplace: item.marketplace,
      url,
      article: item.article,
      id: item.id,
    }).ok,
  );
  if (!match || !isWithinTelegramGrace(match.trackedAt)) return false;
  logTelegramGraceSkip(match.id, match.trackedAt);
  return true;
}

/** Падение цены отслеживаемого товара */
export async function dispatchPriceDropAlert(
  product: Product,
  previousPrice: number,
): Promise<void> {
  const settings = await getPriceAlertSettings();
  if (!settings.notificationsEnabled) return;

  const alertProduct = await resolveTrackedForAlert(product);
  if (!alertProduct) return;

  if (!(await areNotificationsEnabledForProduct(alertProduct.id))) return;
  if (!isSignificantDrop(previousPrice, alertProduct.price, settings)) return;
  if (!(await shouldSendClientDrop(alertDropDedupeKey(alertProduct, 'drop'), alertProduct.price))) {
    return;
  }

  await showPriceDropNotification(alertProduct, previousPrice);

  // Server cron owns Telegram when monitoring is on — avoid double alerts
  if (await isServerPriceMonitoringActive()) return;
  if (shouldSkipTelegramForTracked(alertProduct)) return;

  if (settings.telegramEnabled && settings.telegramChatId.trim()) {
    void sendTelegramPriceAlert({
      chatId: settings.telegramChatId.trim(),
      type: 'price_drop',
      title: alertProduct.title,
      oldPrice: previousPrice,
      newPrice: alertProduct.price,
      url: alertProduct.url,
      marketplace: alertProduct.marketplace,
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

  const alertProduct = await resolveTrackedForAlert(product);
  if (!alertProduct) return;

  if (!(await areNotificationsEnabledForProduct(alertProduct.id))) return;

  await showTargetPriceNotification(alertProduct, targetPrice);

  if (shouldSkipTelegramForTracked(alertProduct)) return;

  if (settings.telegramEnabled && settings.telegramChatId.trim()) {
    void sendTelegramPriceAlert({
      chatId: settings.telegramChatId.trim(),
      type: 'target_price',
      title: alertProduct.title,
      newPrice: alertProduct.price,
      targetPrice,
      url: alertProduct.url,
      marketplace: alertProduct.marketplace,
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

  // Hard guard: button URL must belong to the claimed marketplace
  const detected = detectComparisonMarketplace(url);
  if (detected && detected !== marketplace) {
    console.warn('[PriceGuard] blocked compare_price_drop: url/marketplace mismatch', {
      marketplace,
      detected,
    });
    return;
  }

  const dedupeKey = alertDropDedupeKey({ marketplace, url, title: productTitle }, 'drop');
  if (!(await shouldSendClientDrop(dedupeKey, newPrice))) return;

  const label = marketplaceLabel(marketplace);

  await showComparePriceDropNotification(
    productTitle,
    label,
    previousPrice,
    newPrice,
    url,
    marketplace,
  );

  if (await shouldSkipTelegramForUrl(url)) return;

  if (settings.telegramEnabled && settings.telegramChatId.trim()) {
    void sendTelegramPriceAlert({
      chatId: settings.telegramChatId.trim(),
      type: 'compare_price_drop',
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

  const dedupeKey = alertDropDedupeKey(
    {
      marketplace: input.cheaperMarketplace,
      url: input.url,
      title: input.productTitle,
    },
    'cheaper',
  );
  if (!(await shouldSendClientDrop(dedupeKey, input.cheaperPrice))) return;

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

  if (await shouldSkipTelegramForUrl(input.url)) return;

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

/** Test helper */
export function isTelegramGraceTracked(tracked: Pick<TrackedProduct, 'id' | 'trackedAt'>): boolean {
  return isWithinTelegramGrace(tracked.trackedAt);
}
