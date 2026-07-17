/**
 * Анонимный идентификатор устройства для синхронизации и метрик.
 * Хранится в chrome.storage.local, генерируется один раз.
 * Не содержит PII — это случайный UUID.
 */

const DEVICE_ID_KEY = 'priceguard_device_id';

let cached: string | null = null;

function randomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Получить (или создать) стабильный device_id. */
export async function getDeviceId(): Promise<string> {
  if (cached) return cached;

  try {
    const stored = await chrome.storage.local.get(DEVICE_ID_KEY);
    const existing = stored[DEVICE_ID_KEY] as string | undefined;
    if (existing) {
      cached = existing;
      return existing;
    }

    const fresh = randomId();
    await chrome.storage.local.set({ [DEVICE_ID_KEY]: fresh });
    cached = fresh;
    return fresh;
  } catch {
    // storage недоступен (например, в тестах) — вернём эфемерный id
    cached = randomId();
    return cached;
  }
}
