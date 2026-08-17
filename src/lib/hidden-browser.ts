/**
 * Фоновый парсинг без мелькания вкладок: одно свёрнутое окно, одна вкладка.
 * Полный цикл navigate → wait → scrape сериализован через runExclusive —
 * параллельные jobs не подменяют вкладку mid-flight.
 *
 * Закрываем только свою вкладку. chrome.windows.remove — лишь cleanup пустого
 * окна: при restore session / tab groups в том же окне могут оказаться чужие
 * вкладки, и windows.remove закрыл бы всю группу.
 */

const TAB_GROUP_NONE = -1;

function tabGroupId(tab: { groupId?: number } | undefined): number {
  return tab?.groupId ?? TAB_GROUP_NONE;
}

function isGrouped(tab: { groupId?: number } | undefined): boolean {
  const id = tabGroupId(tab);
  return id !== TAB_GROUP_NONE && id !== chrome.tabGroups?.TAB_GROUP_ID_NONE;
}

async function ungroupTabSafe(tab: { id?: number; groupId?: number } | undefined): Promise<void> {
  if (tab?.id == null || !isGrouped(tab)) return;
  try {
    await chrome.tabs.ungroup(tab.id);
  } catch {
    // группа уже снята / вкладка закрыта
  }
}

function findInjectedTab(
  tabs: Array<chrome.tabs.Tab | undefined>,
  url: string,
): chrome.tabs.Tab | undefined {
  const known = tabs.filter((tab): tab is chrome.tabs.Tab => tab != null && tab.id != null);
  return [...known].reverse().find((tab) => {
    const href = tab.pendingUrl ?? tab.url ?? '';
    return href === url || (url.length > 0 && href.startsWith(url));
  });
}

export class HiddenBrowser {
  private windowId?: number;
  private tabId?: number;
  /** True only while the hidden window still has exactly our tab. */
  private windowExclusive = false;
  private queue: Promise<unknown> = Promise.resolve();

  /** Id окна фонового браузера — чтобы не выбирать его как «активный товар». */
  getWindowId(): number | undefined {
    return this.windowId;
  }

  getTabId(): number | undefined {
    return this.tabId;
  }

  /** Window is still dedicated (no user tabs merged in). */
  isExclusiveWindow(): boolean {
    return this.windowExclusive && this.windowId != null;
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
      const reusable = await this.canReuseOwnTab();
      if (reusable) {
        try {
          await chrome.tabs.update(this.tabId, { url, active: false });
          return this.tabId;
        } catch {
          await this.closeInternal();
        }
      } else {
        await this.closeInternal();
      }
    }

    return this.openDedicatedWindow(url);
  }

  private async canReuseOwnTab(): Promise<boolean> {
    if (this.tabId == null) return false;
    let tab: chrome.tabs.Tab;
    try {
      tab = await chrome.tabs.get(this.tabId);
    } catch {
      return false;
    }
    if (tab?.id == null) return false;

    const windowId = tab.windowId;
    let tabsInWindow: chrome.tabs.Tab[] = [];
    try {
      tabsInWindow = await chrome.tabs.query({ windowId });
    } catch {
      return false;
    }

    const others = tabsInWindow.filter((t) => t.id !== tab.id);
    if (others.length > 0) {
      this.windowExclusive = false;
      this.windowId = windowId;
      return false;
    }

    this.windowId = windowId;
    this.windowExclusive = true;
    return true;
  }

  private async openDedicatedWindow(url: string, attempt = 0): Promise<number> {
    // Свёрнутое обычное окно: Chrome загружает страницу до сворачивания.
    const win = await chrome.windows.create({
      url,
      focused: false,
      state: 'minimized',
      type: 'normal',
    });

    const windowId = win.id;
    const tabs: chrome.tabs.Tab[] =
      win.tabs && win.tabs.length > 0
        ? (win.tabs.filter((tab): tab is chrome.tabs.Tab => tab != null) as chrome.tabs.Tab[])
        : windowId != null
          ? await this.queryTabs(windowId)
          : [];

    if (windowId != null && tabs.length === 1 && tabs[0]?.id != null) {
      await ungroupTabSafe(tabs[0]);
      this.windowId = windowId;
      this.tabId = tabs[0].id;
      this.windowExclusive = true;
      return this.tabId;
    }

    // Restore/merge: в окне уже есть чужие вкладки — не забирать его.
    const injected = findInjectedTab(tabs, url);
    if (injected?.id != null) {
      await ungroupTabSafe(injected);
      try {
        await chrome.tabs.remove(injected.id);
      } catch {
        // вкладка уже закрыта пользователем
      }
    }

    if (attempt < 1) {
      return this.openDedicatedWindow(url, attempt + 1);
    }

    throw new Error('Не удалось открыть фоновую вкладку');
  }

  private async queryTabs(windowId: number): Promise<chrome.tabs.Tab[]> {
    try {
      return await chrome.tabs.query({ windowId });
    } catch {
      return [];
    }
  }

  private async closeInternal(): Promise<void> {
    const tabId = this.tabId;
    const windowId = this.windowId;

    try {
      if (tabId == null && windowId == null) return;

      let tab: chrome.tabs.Tab | undefined;
      if (tabId != null) {
        try {
          tab = await chrome.tabs.get(tabId);
        } catch {
          tab = undefined;
        }
      }

      const winId = tab?.windowId ?? windowId;
      const tabsInWindow = winId != null ? await this.queryTabs(winId) : [];
      const others = tabsInWindow.filter((t) => t.id !== tabId);
      const hasOthers = others.length > 0;

      if (tabId != null) {
        if (hasOthers) {
          await ungroupTabSafe(tab ?? { id: tabId });
        }
        try {
          await chrome.tabs.remove(tabId);
        } catch {
          // вкладка уже закрыта
        }
      }

      if (!hasOthers && winId != null) {
        try {
          await chrome.windows.remove(winId);
        } catch {
          // tabs.remove уже закрыл пустое окно
        }
      }
    } finally {
      this.windowId = undefined;
      this.tabId = undefined;
      this.windowExclusive = false;
    }
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
 * Max concurrent hidden-browser windows. Target-marketplace searches still
 * dispatch via Promise.all, but they share one HiddenBrowser (runExclusive
 * serializes navigate→scrape). A pool of 2 opened two minimized windows at
 * once and made SERP + card cascade land in different tabs — 0.9.93 regression.
 */
export const HIDDEN_BROWSER_POOL_SIZE = 1;

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

/**
 * True if this tab is the hidden scrape tab.
 * Window-only match is a hint for a still-exclusive hidden window (1 tab = ours).
 * A user tab in the same window is never hidden.
 */
export function isHiddenBrowserTab(tabId?: number | null, windowId?: number | null): boolean {
  return poolSlots.some((slot) => {
    const hiddenTab = slot.browser.getTabId();
    const hiddenWin = slot.browser.getWindowId();
    if (tabId != null) {
      return hiddenTab != null && tabId === hiddenTab;
    }
    if (windowId != null) {
      return hiddenWin != null && windowId === hiddenWin && slot.browser.isExclusiveWindow();
    }
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
