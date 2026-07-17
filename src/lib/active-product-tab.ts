import { isProductPage } from '@/utils/marketplace';
import { agentLog } from '@/lib/debug-log';
import { getHiddenBrowserTabId, getHiddenBrowserWindowId } from '@/lib/hidden-browser';

export interface TabLike {
  id?: number;
  active?: boolean;
  url?: string;
  windowId?: number;
}

/** Выбрать вкладку с карточкой товара (popup не должен ломать currentWindow). */
export function pickActiveProductTab(tabs: TabLike[]): TabLike | null {
  const hiddenWin = getHiddenBrowserWindowId();
  const hiddenTab = getHiddenBrowserTabId();
  const productTabs = tabs.filter((tab) => {
    if (!tab.url || !isProductPage(tab.url)) return false;
    // Не брать фоновую вкладку сравнения/поиска
    if (hiddenTab != null && tab.id === hiddenTab) return false;
    if (hiddenWin != null && tab.windowId === hiddenWin) return false;
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
    (window) => window.id !== hiddenWin && window.state !== 'minimized',
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
  const picked = pickActiveProductTab(tabs);
  if (!picked?.id) return null;
  return picked as chrome.tabs.Tab;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getContentScriptFiles(): string[] {
  const scripts = chrome.runtime.getManifest().content_scripts;
  if (!scripts?.length) return [];
  return scripts[0].js ?? [];
}

/** Инжект content script на вкладку, открытую до установки расширения. */
export async function ensureContentScript(tabId: number): Promise<boolean> {
  const files = getContentScriptFiles();
  if (!files.length) return false;

  try {
    await chrome.scripting.executeScript({ target: { tabId }, files });
    await delay(700);
    return true;
  } catch {
    return false;
  }
}

export async function sendScrapeProductMessage(
  tabId: number,
  attempts = 4,
): Promise<unknown> {
  let lastError: unknown;
  let injected = false;

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await chrome.tabs.sendMessage(tabId, { type: 'SCRAPE_PRODUCT' });
    } catch (error) {
      lastError = error;

      if (!injected) {
        injected = await ensureContentScript(tabId);
        agentLog(
          'active-product-tab.ts:sendScrapeProductMessage',
          'content script inject fallback',
          { tabId, injected, attempt },
          'I',
        );
        if (injected) continue;
      }

      if (attempt < attempts - 1) await delay(400 * (attempt + 1));
    }
  }

  throw lastError;
}
