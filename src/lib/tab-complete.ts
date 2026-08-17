/**
 * Wait until a tab reaches status=complete, including the race where
 * `complete` already fired before the listener was attached.
 */
export async function waitForTabComplete(
  tabId: number,
  timeoutMs: number,
  timeoutMessage = 'Страница не загрузилась',
): Promise<void> {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === 'complete') return;
  } catch {
    // Tab may not be queryable yet — fall through to the listener.
  }

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      chrome.tabs.onUpdated.removeListener(listener);
      fn();
    };

    const timeout = setTimeout(() => {
      finish(() => reject(new Error(timeoutMessage)));
    }, timeoutMs);

    const listener = (updatedTabId: number, info: chrome.tabs.TabChangeInfo) => {
      if (updatedTabId === tabId && info.status === 'complete') {
        clearTimeout(timeout);
        finish(() => resolve());
      }
    };

    chrome.tabs.onUpdated.addListener(listener);

    void chrome.tabs.get(tabId).then(
      (tab) => {
        if (tab.status === 'complete') {
          clearTimeout(timeout);
          finish(() => resolve());
        }
      },
      () => {
        // keep waiting on the listener
      },
    );
  });
}

export function isTabLoadTimeoutError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error ?? '');
  return /не загрузилась/i.test(msg);
}
