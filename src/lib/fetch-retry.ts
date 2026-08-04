/**
 * Resilient HTTP: timeout, exponential backoff + jitter, typed NetworkFailure.
 * `fetchWithRetry` remains a thin compatibility wrapper returning Response | throw.
 */

export type NetworkFailureKind =
  | 'timeout'
  | 'offline'
  | 'network'
  | 'http4xx'
  | 'http5xx'
  | 'abort';

export interface NetworkFailure {
  kind: NetworkFailureKind;
  status?: number;
  retryable: boolean;
  message: string;
  userMessage: string;
}

export type SafeFetchResult =
  | { ok: true; response: Response; latencyMs: number }
  | { ok: false; error: NetworkFailure; latencyMs: number; response?: Response };

export interface SafeFetchOptions {
  /** Per-attempt abort timeout (ms). Default 10_000. */
  timeoutMs?: number;
  /** Extra retries after the first attempt. Default 2. */
  retries?: number;
  /** Base delay for exponential backoff (ms). Default 600. */
  delayMs?: number;
  backoff?: 'exponential' | 'linear';
  jitter?: boolean;
  retryOn?: number[];
  retryOnNetwork?: boolean;
  respectRetryAfter?: boolean;
}

export interface FetchRetryOptions {
  retries?: number;
  delayMs?: number;
  /** HTTP-коды, при которых повторяем запрос */
  retryOn?: number[];
  timeoutMs?: number;
}

const DEFAULT_RETRY_ON = [429, 500, 502, 503, 504];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withJitter(ms: number, enabled: boolean): number {
  if (!enabled || ms <= 0) return ms;
  const delta = ms * 0.2;
  return Math.max(0, Math.round(ms + (Math.random() * 2 - 1) * delta));
}

function backoffDelay(
  attempt: number,
  baseMs: number,
  mode: 'exponential' | 'linear',
  jitter: boolean,
): number {
  const raw = mode === 'exponential' ? baseMs * 2 ** attempt : baseMs * (attempt + 1);
  return withJitter(raw, jitter);
}

function isOnline(): boolean {
  try {
    if (typeof navigator !== 'undefined' && 'onLine' in navigator) {
      return navigator.onLine !== false;
    }
  } catch {
    // ignore
  }
  return true;
}

function userMessageFor(kind: NetworkFailureKind, status?: number): string {
  switch (kind) {
    case 'offline':
      return 'Нет сети. Проверьте подключение к интернету.';
    case 'timeout':
      return 'Сервер не ответил вовремя. Попробуйте позже.';
    case 'http5xx':
      return 'Сервер временно недоступен. Попробуйте позже.';
    case 'http4xx':
      if (status === 401 || status === 403) return 'Нет доступа к серверу.';
      if (status === 429) return 'Слишком много запросов. Подождите немного.';
      return 'Запрос отклонён сервером.';
    case 'abort':
      return 'Запрос отменён.';
    case 'network':
    default:
      return 'Не удалось связаться с сервером. Проверьте сеть или VPN.';
  }
}

export function classifyHttpStatus(status: number): NetworkFailure {
  const kind: NetworkFailureKind = status >= 500 ? 'http5xx' : 'http4xx';
  const retryable = status === 429 || status >= 500;
  return {
    kind,
    status,
    retryable,
    message: `HTTP ${status}`,
    userMessage: userMessageFor(kind, status),
  };
}

export function classifyFetchError(error: unknown): NetworkFailure {
  const msg = error instanceof Error ? error.message : String(error ?? '');
  const lower = msg.toLowerCase();
  if (error instanceof DOMException && error.name === 'AbortError') {
    return {
      kind: 'timeout',
      retryable: true,
      message: msg || 'Aborted',
      userMessage: userMessageFor('timeout'),
    };
  }
  if (lower.includes('aborted') || lower.includes('timeout')) {
    return {
      kind: 'timeout',
      retryable: true,
      message: msg,
      userMessage: userMessageFor('timeout'),
    };
  }
  if (!isOnline()) {
    return {
      kind: 'offline',
      retryable: true,
      message: msg || 'offline',
      userMessage: userMessageFor('offline'),
    };
  }
  return {
    kind: 'network',
    retryable: true,
    message: msg || 'Failed to fetch',
    userMessage: userMessageFor('network'),
  };
}

function parseRetryAfterMs(response: Response): number | null {
  const raw = response.headers.get('Retry-After');
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 60_000);
  const date = Date.parse(raw);
  if (!Number.isNaN(date)) return Math.min(Math.max(0, date - Date.now()), 60_000);
  return null;
}

/**
 * Fetch with timeout, exponential backoff + jitter, and typed failure.
 * Does not throw for HTTP errors — returns SafeFetchResult.
 * Network exhaustion returns ok:false (does not throw).
 */
export async function safeFetch(
  url: string,
  init?: RequestInit,
  options: SafeFetchOptions = {},
): Promise<SafeFetchResult> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const retries = options.retries ?? 2;
  const delayMs = options.delayMs ?? 600;
  const backoff = options.backoff ?? 'exponential';
  const jitter = options.jitter ?? true;
  const retryOn = options.retryOn ?? DEFAULT_RETRY_ON;
  const retryOnNetwork = options.retryOnNetwork ?? true;
  const respectRetryAfter = options.respectRetryAfter ?? true;

  const started = Date.now();

  if (!isOnline()) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      error: {
        kind: 'offline',
        retryable: true,
        message: 'offline',
        userMessage: userMessageFor('offline'),
      },
    };
  }

  let lastFailure: NetworkFailure | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const parentSignal = init?.signal;
    const onParentAbort = () => controller.abort();
    if (parentSignal) {
      if (parentSignal.aborted) controller.abort();
      else parentSignal.addEventListener('abort', onParentAbort, { once: true });
    }

    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timeoutId);
      parentSignal?.removeEventListener('abort', onParentAbort);

      if (response.ok) {
        return { ok: true, response, latencyMs: Date.now() - started };
      }

      const failure = classifyHttpStatus(response.status);
      lastFailure = failure;

      const canRetry = failure.retryable && retryOn.includes(response.status) && attempt < retries;
      if (!canRetry) {
        return {
          ok: false,
          latencyMs: Date.now() - started,
          error: failure,
          response,
        };
      }

      let wait = backoffDelay(attempt, delayMs, backoff, jitter);
      if (respectRetryAfter && response.status === 429) {
        const ra = parseRetryAfterMs(response);
        if (ra != null) wait = Math.max(wait, ra);
      }
      // Drain body to free connection
      await response.arrayBuffer().catch(() => undefined);
      await sleep(wait);
    } catch (error) {
      clearTimeout(timeoutId);
      parentSignal?.removeEventListener('abort', onParentAbort);

      if (parentSignal?.aborted) {
        return {
          ok: false,
          latencyMs: Date.now() - started,
          error: {
            kind: 'abort',
            retryable: false,
            message: 'aborted',
            userMessage: userMessageFor('abort'),
          },
        };
      }

      const failure = classifyFetchError(error);
      lastFailure = failure;
      if (!retryOnNetwork || !failure.retryable || attempt >= retries) {
        return { ok: false, latencyMs: Date.now() - started, error: failure };
      }
      await sleep(backoffDelay(attempt, delayMs, backoff, jitter));
    }
  }

  return {
    ok: false,
    latencyMs: Date.now() - started,
    error: lastFailure ?? {
      kind: 'network',
      retryable: true,
      message: 'fetch failed',
      userMessage: userMessageFor('network'),
    },
  };
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
 * Compatibility wrapper: returns Response on HTTP (even error), throws on network exhaustion.
 * Prefer `safeFetch` for new code.
 */
export async function fetchWithRetry(
  url: string,
  init?: RequestInit,
  options: FetchRetryOptions = {},
): Promise<Response> {
  const result = await safeFetch(url, init, {
    retries: options.retries ?? 2,
    delayMs: options.delayMs ?? 800,
    retryOn: options.retryOn ?? DEFAULT_RETRY_ON,
    timeoutMs: options.timeoutMs ?? 15_000,
    backoff: 'exponential',
    jitter: true,
  });

  if (result.ok) return result.response;

  if (result.response) return result.response;

  throw new Error(result.error.message || 'Не удалось выполнить запрос');
}

export function apiErrorMessage(marketplace: string, status?: number): string {
  if (status === 403) {
    return `${marketplace}: доступ к API ограничен — ищем через браузер`;
  }
  if (status === 429) {
    return `${marketplace} временно недоступен из‑за лимита запросов. Попробуйте позже или укажите ссылку вручную.`;
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
