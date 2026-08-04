import { agentLog } from '@/lib/debug-log';
import {
  getHiddenBrowserTabId,
  getHiddenBrowserWindowId,
  isHiddenBrowserTab,
} from '@/lib/hidden-browser';
import { ensureContentScriptReady, safeSendMessage } from '@/lib/safe-messaging';
import { isProductPage } from '@/utils/marketplace';

export interface TabLike {
  id?: number;
  active?: boolean;
  url?: string;
  windowId?: number;
  /** chrome.windows.WindowState when known */
  windowState?: string;
}

/** Выбрать вкладку с карточкой товара (popup не должен ломать currentWindow). */
export function pickActiveProductTab(tabs: TabLike[]): TabLike | null {
  const hiddenWin = getHiddenBrowserWindowId();
  const hiddenTab = getHiddenBrowserTabId();
  const productTabs = tabs.filter((tab) => {
    if (!tab.url || !isProductPage(tab.url)) return false;
    if (hiddenTab != null && tab.id === hiddenTab) return false;
    if (hiddenWin != null && tab.windowId === hiddenWin) return false;
    if (isHiddenBrowserTab(tab.id, tab.windowId)) return false;
    if (tab.windowState === 'minimized') return false;
    return true;
  });
  if (productTabs.length === 0) return null;

  const activeProduct = productTabs.find((tab) => tab.active);
  if (activeProduct) return activeProduct;

  return productTabs[0] ?? null;
}

export async function findActiveProductTab(): Promise<chrome.tabs.Tab | null> {
  const hiddenWin = getHiddenBrowserWindowId();
  const normalWindows = await chrome.windows.getAll({ windowTypes: ['normal'] });
  const visibleWindows = normalWindows.filter(
    (window) =>
      window.id !== hiddenWin &&
      window.state !== 'minimized' &&
      !isHiddenBrowserTab(undefined, window.id),
  );
  const browserWindow =
    visibleWindows.find((window) => window.focused) ??
    visibleWindows.sort((a, b) => (b.id ?? 0) - (a.id ?? 0))[0];

  if (browserWindow?.id != null) {
    const [activeInBrowser] = await chrome.tabs.query({
      active: true,
      windowId: browserWindow.id,
    });
    if (activeInBrowser?.url && isProductPage(activeInBrowser.url)) {
      return activeInBrowser;
    }
  }

  const tabs = await chrome.tabs.query({});
  const windowStateById = new Map(normalWindows.map((w) => [w.id, w.state] as const));
  const enriched: TabLike[] = tabs.map((tab) => ({
    ...tab,
    windowState: tab.windowId != null ? windowStateById.get(tab.windowId) : undefined,
  }));
  const picked = pickActiveProductTab(enriched);
  if (!picked?.id) return null;
  return picked as chrome.tabs.Tab;
}

/** @deprecated use ensureContentScriptReady from safe-messaging */
export async function ensureContentScript(tabId: number): Promise<boolean> {
  return ensureContentScriptReady(tabId);
}

export async function sendScrapeProductMessage(
  tabId: number,
  attempts = 4,
): Promise<unknown> {
  const result = await safeSendMessage(
    { type: 'tab', tabId },
    { type: 'SCRAPE_PRODUCT' },
    {
      retries: Math.max(0, attempts - 1),
      reinject: true,
      backoffMs: [400, 800, 1200, 1600],
      softFail: false,
    },
  );
  if (result == null) {
    agentLog(
      'active-product-tab.ts:sendScrapeProductMessage',
      'scrape message failed after retries',
      { tabId },
      'W',
    );
    throw new Error('Receiving end does not exist');
  }
  return result;
}
