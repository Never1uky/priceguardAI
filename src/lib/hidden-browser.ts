/**
 * Фоновый парсинг без мелькания вкладок: одно свёрнутое окно, одна вкладка.
 * Полный цикл navigate → wait → scrape сериализован через runExclusive —
 * параллельные jobs не подменяют вкладку mid-flight.
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

  /**
   * Run exclusive work on the singleton tab.
   * Pass `nav` into the callback — do NOT call `navigate()` from inside (deadlock).
   */
  async runExclusive<T>(
    fn: (nav: (url: string) => Promise<number>) => Promise<T>,
  ): Promise<T> {
    const nav = (url: string) => this.navigateInternal(url);
    const next = this.queue.then(
      () => fn(nav),
      () => fn(nav),
    );
    this.queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  /** Navigation-only exclusive slot (compat). Prefer runExclusive for full scrape cycles. */
  async navigate(url: string): Promise<number> {
    return this.runExclusive((nav) => nav(url));
  }

  private async navigateInternal(url: string): Promise<number> {
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
    const next = this.queue.then(
      () => this.closeInternal(),
      () => this.closeInternal(),
    );
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
let idleCloseTimer: ReturnType<typeof setTimeout> | null = null;

/** Close unused hidden window after this idle (users === 0). */
export const HIDDEN_BROWSER_IDLE_CLOSE_MS = 45_000;

function clearIdleCloseTimer(): void {
  if (idleCloseTimer != null) {
    clearTimeout(idleCloseTimer);
    idleCloseTimer = null;
  }
}

export function getHiddenBrowser(): HiddenBrowser {
  if (!sharedSession) {
    sharedSession = new HiddenBrowser();
  }
  return sharedSession;
}

/** Взять shared-сессию (refcount). Пара с releaseHiddenBrowser. */
export function acquireHiddenBrowser(): HiddenBrowser {
  clearIdleCloseTimer();
  hiddenBrowserUsers += 1;
  return getHiddenBrowser();
}

/** Отпустить сессию; закрыть окно только когда никто больше не использует. */
export async function releaseHiddenBrowser(): Promise<void> {
  hiddenBrowserUsers = Math.max(0, hiddenBrowserUsers - 1);
  if (hiddenBrowserUsers === 0) {
    scheduleHiddenBrowserIdleClose();
  }
}

/** Schedule close when refcount is 0 (debounce parallel releases). */
export function scheduleHiddenBrowserIdleClose(delayMs = HIDDEN_BROWSER_IDLE_CLOSE_MS): void {
  clearIdleCloseTimer();
  if (hiddenBrowserUsers > 0) return;
  idleCloseTimer = setTimeout(() => {
    idleCloseTimer = null;
    if (hiddenBrowserUsers > 0) return;
    void closeHiddenBrowser();
  }, delayMs);
}

/** Force close now if idle (used after compare job). */
export async function closeHiddenBrowserIfIdle(): Promise<void> {
  if (hiddenBrowserUsers > 0) return;
  clearIdleCloseTimer();
  await closeHiddenBrowser();
}

export function getHiddenBrowserWindowId(): number | undefined {
  return sharedSession?.getWindowId();
}

export function getHiddenBrowserTabId(): number | undefined {
  return sharedSession?.getTabId();
}

export function getHiddenBrowserUserCount(): number {
  return hiddenBrowserUsers;
}

/** True if tab/window belongs to the shared hidden scrape session. */
export function isHiddenBrowserTab(tabId?: number | null, windowId?: number | null): boolean {
  const hiddenTab = getHiddenBrowserTabId();
  const hiddenWin = getHiddenBrowserWindowId();
  if (tabId != null && hiddenTab != null && tabId === hiddenTab) return true;
  if (windowId != null && hiddenWin != null && windowId === hiddenWin) return true;
  return false;
}

export async function closeHiddenBrowser(): Promise<void> {
  clearIdleCloseTimer();
  if (sharedSession) {
    await sharedSession.close();
    sharedSession = null;
  }
  hiddenBrowserUsers = 0;
}

/** @internal test helper */
export function __resetHiddenBrowserForTests(): void {
  clearIdleCloseTimer();
  sharedSession = null;
  hiddenBrowserUsers = 0;
}
