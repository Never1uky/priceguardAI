import { isContextInvalidatedError, isExtensionContextValid } from '@/lib/extension-context';
import { safeSendMessage } from '@/lib/safe-messaging';

/** Повтор при холодном старте service worker. */
export async function sendRuntimeMessage<T>(
  message: unknown,
  attempts = 3,
): Promise<T> {
  if (!isExtensionContextValid()) {
    throw new Error('Расширение обновлено — закройте и откройте popup снова');
  }

  try {
    const result = await safeSendMessage<T>({ type: 'runtime' }, message, {
      retries: Math.max(0, attempts - 1),
      backoffMs: [250, 500, 750],
      softFail: false,
    });
    if (result == null) {
      throw new Error('Расширение обновлено — закройте и откройте popup снова');
    }
    return result;
  } catch (error) {
    if (isContextInvalidatedError(error)) {
      throw new Error('Расширение обновлено — закройте и откройте popup снова');
    }
    throw error;
  }
}
