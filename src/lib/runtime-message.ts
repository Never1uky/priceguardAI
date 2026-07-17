import { isContextInvalidatedError, isExtensionContextValid } from '@/lib/extension-context';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Повтор при холодном старте service worker. */
export async function sendRuntimeMessage<T>(
  message: unknown,
  attempts = 3,
): Promise<T> {
  if (!isExtensionContextValid()) {
    throw new Error('Расширение обновлено — закройте и откройте popup снова');
  }

  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return (await chrome.runtime.sendMessage(message)) as T;
    } catch (error) {
      lastError = error;
      if (isContextInvalidatedError(error)) {
        throw new Error('Расширение обновлено — закройте и откройте popup снова');
      }
      if (attempt < attempts - 1) await delay(250 * (attempt + 1));
    }
  }

  throw lastError;
}
