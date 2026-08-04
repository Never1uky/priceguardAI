const INVALIDATED = 'Extension context invalidated';

export function isExtensionContextValid(): boolean {
  try {
    return Boolean(chrome.runtime?.id);
  } catch {
    return false;
  }
}

export function isContextInvalidatedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes(INVALIDATED);
}

export function isReceivingEndError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error ?? '');
  return /receiving end does not exist|could not establish connection|no.*message.*receiver/i.test(
    msg,
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Content → SW: never throws. Retries Receiving end (cold SW wake).
 * Returns null on invalidated / exhausted retries.
 */
export async function safeRuntimeSend<T = unknown>(message: unknown): Promise<T | null> {
  if (!isExtensionContextValid()) return null;

  const backoff = [150, 350, 700];
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return (await chrome.runtime.sendMessage(message)) as T;
    } catch (error) {
      if (isContextInvalidatedError(error)) return null;
      if (isReceivingEndError(error) && attempt < 2) {
        await delay(backoff[attempt] ?? 400);
        continue;
      }
      if (attempt < 2 && !isContextInvalidatedError(error)) {
        await delay(backoff[attempt] ?? 400);
        continue;
      }
      return null;
    }
  }
  return null;
}

/** Однократная перезагрузка страницы после обновления расширения. */
export function reloadPageIfExtensionWasUpdated(): void {
  if (typeof sessionStorage === 'undefined') return;
  if (!isExtensionContextValid()) {
    const key = 'priceguard_ctx_reload';
    if (!sessionStorage.getItem(key)) {
      sessionStorage.setItem(key, '1');
      window.location.reload();
    }
  }
}
