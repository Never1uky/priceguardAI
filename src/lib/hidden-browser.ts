/**
 * Фоновый парсинг без мелькания вкладок: одно свёрнутое окно, одна вкладка.
 * Навигации сериализованы — параллельные поиски не открывают кучу окон.
 */

export class HiddenBrowser {
  private windowId?: number;
  private tabId?: number;
  private queue: Promise<unknown> = Promise.resolve();

  /** Id окна фонового браузера — чтобы не выбирать его как «активный товар». */
  getWindowId(): number | undefined {
    return this.windowId;
  }

  getTabId(): number | undefined {
    return this.tabId;
  }

  async navigate(url: string): Promise<number> {
    const run = async (): Promise<number> => {
      if (this.tabId != null && this.windowId != null) {
        try {
          await chrome.tabs.update(this.tabId, { url, active: false });
          return this.tabId;
        } catch {
          await this.closeInternal();
        }
      }

      // Свёрнутое обычное окно: Chrome загружает страницу до сворачивания.
      const win = await chrome.windows.create({
        url,
        focused: false,
        state: 'minimized',
        type: 'normal',
      });

      this.windowId = win.id;
      this.tabId = win.tabs?.[0]?.id ?? (await this.resolveTabId(win.id));

      if (!this.tabId) {
        throw new Error('Не удалось открыть фоновую вкладку');
      }

      return this.tabId;
    };

    const next = this.queue.then(run, run);
    this.queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private async resolveTabId(windowId?: number): Promise<number | undefined> {
    if (windowId == null) return undefined;
    try {
      const tabs = await chrome.tabs.query({ windowId });
      return tabs[0]?.id;
    } catch {
      return undefined;
    }
  }

  private async closeInternal(): Promise<void> {
    if (this.windowId != null) {
      try {
        await chrome.windows.remove(this.windowId);
      } catch {
        if (this.tabId != null) {
          try {
            await chrome.tabs.remove(this.tabId);
          } catch {
            // окно уже закрыто
          }
        }
      }
    }

    this.windowId = undefined;
    this.tabId = undefined;
  }

  async close(): Promise<void> {
    const next = this.queue.then(() => this.closeInternal(), () => this.closeInternal());
    this.queue = next.then(
      () => undefined,
      () => undefined,
    );
    await next;
  }
}

let sharedSession: HiddenBrowser | null = null;
/** Сколько параллельных searchViaBrowserTab держат сессию открытой */
let hiddenBrowserUsers = 0;

export function getHiddenBrowser(): HiddenBrowser {
  if (!sharedSession) {
    sharedSession = new HiddenBrowser();
  }
  return sharedSession;
}

/** Взять shared-сессию (refcount). Пара с releaseHiddenBrowser. */
export function acquireHiddenBrowser(): HiddenBrowser {
  hiddenBrowserUsers += 1;
  return getHiddenBrowser();
}

/** Отпустить сессию; закрыть окно только когда никто больше не использует. */
export async function releaseHiddenBrowser(): Promise<void> {
  hiddenBrowserUsers = Math.max(0, hiddenBrowserUsers - 1);
  if (hiddenBrowserUsers === 0) {
    await closeHiddenBrowser();
  }
}

export function getHiddenBrowserWindowId(): number | undefined {
  return sharedSession?.getWindowId();
}

export function getHiddenBrowserTabId(): number | undefined {
  return sharedSession?.getTabId();
}

export async function closeHiddenBrowser(): Promise<void> {
  if (sharedSession) {
    await sharedSession.close();
    sharedSession = null;
  }
  hiddenBrowserUsers = 0;
}
