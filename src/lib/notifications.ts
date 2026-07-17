import { formatPrice } from '@/lib/utils';
import { makeReferralLinkAsync } from '@/utils/referral';
import type { Product } from '@/types/product';
import type { Marketplace } from '@/types/product';
import { detectMarketplace } from '@/utils/marketplace';

const NOTIFICATION_ICON = 'public/icons/icon128.png';
const URL_PREFIX = 'pg_notify_url_';

async function createNotification(
  notificationId: string,
  title: string,
  message: string,
  url: string,
  marketplace?: Marketplace,
): Promise<void> {
  const referralUrl = await makeReferralLinkAsync(url, marketplace ?? detectMarketplace(url) ?? undefined);
  await chrome.storage.local.set({ [`${URL_PREFIX}${notificationId}`]: referralUrl });

  await chrome.notifications.create(notificationId, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL(NOTIFICATION_ICON),
    title,
    message,
    priority: 2,
    buttons: [{ title: 'Открыть товар' }],
    requireInteraction: true,
  });
}

export async function showPriceDropNotification(
  product: Product,
  previousPrice: number,
): Promise<void> {
  const diff = previousPrice - product.price;
  const title = 'Цена снизилась!';
  const message = `${product.title.slice(0, 72)}${product.title.length > 72 ? '…' : ''}: ${formatPrice(previousPrice)} → ${formatPrice(product.price)} (−${formatPrice(diff)})`;

  await createNotification(
    `price-drop-${product.id}-${Date.now()}`,
    title,
    message,
    product.url,
    product.marketplace,
  );
}

export async function showTargetPriceNotification(
  product: Product,
  targetPrice: number,
): Promise<void> {
  const title = 'Целевая цена достигнута!';
  const message = `${product.title.slice(0, 60)}… — ${formatPrice(product.price)} (цель: ${formatPrice(targetPrice)})`;

  await createNotification(
    `target-${product.id}-${Date.now()}`,
    title,
    message,
    product.url,
    product.marketplace,
  );
}

export async function showComparePriceDropNotification(
  productTitle: string,
  marketplaceLabel: string,
  previousPrice: number,
  newPrice: number,
  url: string,
  marketplace?: Marketplace,
): Promise<void> {
  const diff = previousPrice - newPrice;
  const title = `Снижение цены на ${marketplaceLabel}`;
  const message = `${productTitle.slice(0, 60)}${productTitle.length > 60 ? '…' : ''}: ${formatPrice(previousPrice)} → ${formatPrice(newPrice)} (−${formatPrice(diff)})`;

  await createNotification(
    `compare-drop-${Date.now()}`,
    title,
    message,
    url,
    marketplace,
  );
}

export async function showCompareCheaperElsewhereNotification(
  productTitle: string,
  sourceLabel: string,
  sourcePrice: number,
  cheaperLabel: string,
  cheaperPrice: number,
  url: string,
  marketplace?: Marketplace,
): Promise<void> {
  const diff = sourcePrice - cheaperPrice;
  const title = `Дешевле на ${cheaperLabel}`;
  const message = `${productTitle.slice(0, 48)}${productTitle.length > 48 ? '…' : ''}: ${sourceLabel} ${formatPrice(sourcePrice)} → ${cheaperLabel} ${formatPrice(cheaperPrice)} (−${formatPrice(diff)})`;

  await createNotification(
    `compare-cheaper-${Date.now()}`,
    title,
    message,
    url,
    marketplace,
  );
}

async function openNotificationUrl(notificationId: string): Promise<void> {
  const key = `${URL_PREFIX}${notificationId}`;
  const result = await chrome.storage.local.get(key);
  const url = result[key] as string | undefined;

  if (url) {
    await chrome.tabs.create({ url });
    await chrome.storage.local.remove(key);
  }

  await chrome.notifications.clear(notificationId);
}

export function setupNotificationHandlers(): void {
  chrome.notifications.onClicked.addListener((notificationId) => {
    void openNotificationUrl(notificationId);
  });

  chrome.notifications.onButtonClicked.addListener((notificationId) => {
    void openNotificationUrl(notificationId);
  });
}
