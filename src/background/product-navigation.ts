/**
 * Отслеживание навигации на карточках товаров без polling в popup.
 * — полная загрузка: webNavigation.onCompleted
 * — SPA (pushState): webNavigation.onHistoryStateUpdated
 */

import { isProductPage } from '@/utils/marketplace';

const MARKETPLACE_HOST_RE = /wildberries\.ru|ozon\.ru|market\.yandex\.ru/i;

function isMarketplaceUrl(url: string): boolean {
  return MARKETPLACE_HOST_RE.test(url);
}

/** Рассылаем событие всем слушателям (popup, если открыт) */
function broadcastProductPageChanged(tabId: number, url: string): void {
  void chrome.runtime
    .sendMessage({
      type: 'PRODUCT_PAGE_CHANGED',
      payload: { tabId, url, isProductPage: isProductPage(url) },
    })
    .catch(() => {
      // Popup закрыт — это нормально
    });
}

function handleNavigation(tabId: number, url: string): void {
  if (!isMarketplaceUrl(url)) return;
  if (!isProductPage(url)) return;
  broadcastProductPageChanged(tabId, url);
}

export function setupProductPageNavigation(): void {
  chrome.webNavigation.onCompleted.addListener((details) => {
    if (details.frameId !== 0) return;
    handleNavigation(details.tabId, details.url);
  });

  chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
    if (details.frameId !== 0) return;
    handleNavigation(details.tabId, details.url);
  });
}
