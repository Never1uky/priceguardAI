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

let poolSlots: Array<{ browser: HiddenBrowser; users: number }> = [];
let idleCloseTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Max concurrent hidden-browser windows. marketplace-search.ts already
 * dispatches target-marketplace searches via Promise.all (V4 "parallel
 * search"), but every one of them used to funnel through a single shared
 * HiddenBrowser instance, re-serializing what looked parallel at the call
 * site. With the current 3-marketplace universe, at most 2 target
 * marketplaces are ever searched at once (source marketplace is excluded),
 * so a pool of 2 gives real parallelism without opening more background
 * windows than could ever usefully run concurrently today. Free to raise if
 * the marketplace count grows (see docs on marketplace architecture).
 */
export const HIDDEN_BROWSER_POOL_SIZE = 2;

/** Close unused hidden window after this idle (users === 0). */
export const HIDDEN_BROWSER_IDLE_CLOSE_MS = 45_000;

function clearIdleCloseTimer(): void {
  if (idleCloseTimer != null) {
    clearTimeout(idleCloseTimer);
    idleCloseTimer = null;
  }
}

function totalUsers(): number {
  return poolSlots.reduce((sum, slot) => sum + slot.users, 0);
}

/** Primary/first pool session — back-compat for callers that only need "a" hidden browser. */
export function getHiddenBrowser(): HiddenBrowser {
  if (poolSlots.length === 0) {
    poolSlots.push({ browser: new HiddenBrowser(), users: 0 });
  }
  return poolSlots[0].browser;
}

/**
 * Take a session from the pool (refcounted per-slot, not globally): reuses
 * a fully-idle slot if one exists, otherwise grows the pool up to
 * HIDDEN_BROWSER_POOL_SIZE, otherwise shares the least-busy existing slot.
 * Pair with releaseHiddenBrowser(browser) — pass back the exact instance
 * returned here so the right slot's refcount is decremented.
 */
export function acquireHiddenBrowser(): HiddenBrowser {
  clearIdleCloseTimer();

  const idle = poolSlots.find((slot) => slot.users === 0);
  if (idle) {
    idle.users += 1;
    return idle.browser;
  }

  if (poolSlots.length < HIDDEN_BROWSER_POOL_SIZE) {
    const slot = { browser: new HiddenBrowser(), users: 1 };
    poolSlots.push(slot);
    return slot.browser;
  }

  const leastBusy = poolSlots.reduce((min, slot) => (slot.users < min.users ? slot : min));
  leastBusy.users += 1;
  return leastBusy.browser;
}

/** Release a session acquired via acquireHiddenBrowser(browser-instance-aware). */
export async function releaseHiddenBrowser(browser?: HiddenBrowser): Promise<void> {
  const slot = browser
    ? poolSlots.find((s) => s.browser === browser)
    : poolSlots[0];
  if (slot) {
    slot.users = Math.max(0, slot.users - 1);
  }
  if (totalUsers() === 0) {
    scheduleHiddenBrowserIdleClose();
  }
}

/** Schedule close when refcount is 0 (debounce parallel releases). */
export function scheduleHiddenBrowserIdleClose(delayMs = HIDDEN_BROWSER_IDLE_CLOSE_MS): void {
  clearIdleCloseTimer();
  if (totalUsers() > 0) return;
  idleCloseTimer = setTimeout(() => {
    idleCloseTimer = null;
    if (totalUsers() > 0) return;
    void closeHiddenBrowser();
  }, delayMs);
}

/** Force close now if idle (used after compare job). */
export async function closeHiddenBrowserIfIdle(): Promise<void> {
  if (totalUsers() > 0) return;
  clearIdleCloseTimer();
  await closeHiddenBrowser();
}

/** Primary session's window id — sufficient for the pre-filter callers do before isHiddenBrowserTab(). */
export function getHiddenBrowserWindowId(): number | undefined {
  return poolSlots[0]?.browser.getWindowId();
}

export function getHiddenBrowserTabId(): number | undefined {
  return poolSlots[0]?.browser.getTabId();
}

export function getHiddenBrowserUserCount(): number {
  return totalUsers();
}

/** True if tab/window belongs to ANY pool session — this is the authoritative check. */
export function isHiddenBrowserTab(tabId?: number | null, windowId?: number | null): boolean {
  return poolSlots.some((slot) => {
    const hiddenTab = slot.browser.getTabId();
    const hiddenWin = slot.browser.getWindowId();
    if (tabId != null && hiddenTab != null && tabId === hiddenTab) return true;
    if (windowId != null && hiddenWin != null && windowId === hiddenWin) return true;
    return false;
  });
}

export async function closeHiddenBrowser(): Promise<void> {
  clearIdleCloseTimer();
  await Promise.all(poolSlots.map((slot) => slot.browser.close()));
  poolSlots = [];
}

/** @internal test helper */
export function __resetHiddenBrowserForTests(): void {
  clearIdleCloseTimer();
  poolSlots = [];
}
