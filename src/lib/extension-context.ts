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

/** Безопасная отправка из content script — не бросает при перезагрузке расширения. */
export async function safeRuntimeSend<T = unknown>(message: unknown): Promise<T | null> {
  if (!isExtensionContextValid()) return null;

  try {
    return (await chrome.runtime.sendMessage(message)) as T;
  } catch (error) {
    if (isContextInvalidatedError(error)) return null;
    throw error;
  }
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
