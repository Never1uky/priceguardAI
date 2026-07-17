export interface FetchRetryOptions {
  retries?: number;
  delayMs?: number;
  /** HTTP-коды, при которых повторяем запрос */
  retryOn?: number[];
}

/** Коды, при которых имеет смысл повторить запрос */
const DEFAULT_RETRY_ON = [429, 500, 502, 503, 504];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class FetchHttpError extends Error {
  readonly status: number;
  readonly body?: string;

  constructor(message: string, status: number, body?: string) {
    super(message);
    this.name = 'FetchHttpError';
    this.status = status;
    this.body = body;
  }
}

/**
 * fetch с повторами.
 * Повторяет только rate-limit и серверные ошибки, не 401/403/400.
 */
export async function fetchWithRetry(
  url: string,
  init?: RequestInit,
  options: FetchRetryOptions = {},
): Promise<Response> {
  const retries = options.retries ?? 2;
  const delayMs = options.delayMs ?? 800;
  const retryOn = options.retryOn ?? DEFAULT_RETRY_ON;

  let lastError: Error | null = null;
  let lastResponse: Response | null = null;
  let lastBody = '';

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, init);
      lastResponse = response;

      if (response.ok) {
        return response;
      }

      lastBody = await response.text().catch(() => '');
      lastError = new FetchHttpError(`HTTP ${response.status}`, response.status, lastBody);

      const canRetry = retryOn.includes(response.status) && attempt < retries;
      if (!canRetry) {
        return response;
      }

      await sleep(delayMs * (attempt + 1));
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt === retries) break;
      await sleep(delayMs * (attempt + 1));
    }
  }

  if (lastResponse) {
    return lastResponse;
  }

  throw lastError ?? new Error('Не удалось выполнить запрос');
}

export function apiErrorMessage(marketplace: string, status?: number): string {
  if (status === 403) {
    return `${marketplace}: доступ к API ограничен — ищем через браузер`;
  }
  if (status === 429) {
    return `${marketplace}: слишком много запросов — повторите позже`;
  }
  if (status) {
    return `${marketplace}: ошибка API (${status})`;
  }
  return `${marketplace}: не удалось подключиться к API`;
}

/** @deprecated используйте formatApiErrorForUser из @/api/errors */
export function userFacingError(error: unknown, fallback = 'Ошибка загрузки'): string {
  const msg = error instanceof Error ? error.message : String(error);
  if (/window is not defined|document is not defined|ServiceWorker/i.test(msg)) {
    return fallback;
  }
  return msg || fallback;
}
