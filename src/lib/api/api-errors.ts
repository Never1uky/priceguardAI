/**
 * Централизованная обработка ошибок API (Grok, OpenAI, Supabase).
 * Преобразует технические ответы в понятные сообщения на русском.
 */

export type ApiErrorCode =
  | 'network'
  | 'timeout'
  | 'unauthorized'
  | 'forbidden'
  | 'rate_limit'
  | 'insufficient_quota'
  | 'invalid_key'
  | 'bad_request'
  | 'server_error'
  | 'empty_response'
  | 'parse_error'
  | 'not_configured'
  | 'unknown';

export interface ApiErrorDetails {
  code: ApiErrorCode;
  status?: number;
  provider?: string;
  userMessage: string;
  retryable: boolean;
  /** Техническое описание для логов */
  debugMessage?: string;
}

/** Структурированная ошибка API */
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status?: number;
  readonly provider?: string;
  readonly userMessage: string;
  readonly retryable: boolean;
  readonly debugMessage?: string;

  constructor(details: ApiErrorDetails) {
    super(details.userMessage);
    this.name = 'ApiError';
    this.code = details.code;
    this.status = details.status;
    this.provider = details.provider;
    this.userMessage = details.userMessage;
    this.retryable = details.retryable;
    this.debugMessage = details.debugMessage;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/** Извлечь message из JSON тела OpenAI / Grok / xAI */
function extractApiErrorMessage(bodyText: string): string | undefined {
  if (!bodyText.trim()) return undefined;

  try {
    const json = JSON.parse(bodyText) as {
      error?: {
        message?: string;
        code?: string;
        type?: string;
      };
      message?: string;
    };

    return json.error?.message ?? json.message;
  } catch {
    const trimmed = bodyText.trim();
    if (trimmed.length <= 300 && !trimmed.startsWith('<')) {
      return trimmed;
    }
    return undefined;
  }
}

function mapStatusToCode(status: number, apiMessage?: string): ApiErrorCode {
  const lower = (apiMessage ?? '').toLowerCase();

  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 429) return 'rate_limit';
  if (status === 402 || lower.includes('insufficient') || lower.includes('quota')) {
    return 'insufficient_quota';
  }
  if (
    status === 400 &&
    (lower.includes('api key') ||
      lower.includes('apikey') ||
      lower.includes('invalid') ||
      lower.includes('authentication'))
  ) {
    return 'invalid_key';
  }
  if (status >= 500) return 'server_error';
  if (status >= 400) return 'bad_request';
  return 'unknown';
}

function buildUserMessage(
  code: ApiErrorCode,
  provider?: string,
  status?: number,
  apiMessage?: string,
): string {
  const prefix = provider ? `${provider}: ` : '';

  switch (code) {
    case 'network':
      return `${prefix}Нет подключения к интернету. Проверьте сеть и повторите.`;
    case 'timeout':
      return `${prefix}Превышено время ожидания ответа. Попробуйте ещё раз.`;
    case 'unauthorized':
    case 'invalid_key':
      return `${prefix}Неверный API-ключ. Проверьте ключ во вкладке «Настройки».`;
    case 'forbidden':
      return `${prefix}Доступ запрещён. Возможно, ключ неактивен или регион ограничен.`;
    case 'rate_limit':
      return `${prefix}Слишком много запросов. Подождите 1–2 минуты и повторите.`;
    case 'insufficient_quota':
      return `${prefix}Закончился баланс API. Пополните счёт на console.x.ai или platform.openai.com.`;
    case 'bad_request':
      return apiMessage
        ? `${prefix}${sanitizeApiMessage(apiMessage)}`
        : `${prefix}Некорректный запрос${status ? ` (${status})` : ''}.`;
    case 'server_error':
      return `${prefix}Временная ошибка сервера${status ? ` (${status})` : ''}. Повторите позже.`;
    case 'empty_response':
      return `${prefix}API вернул пустой ответ. Попробуйте снова.`;
    case 'parse_error':
      return `${prefix}Не удалось разобрать ответ AI. Повторите анализ.`;
    case 'not_configured':
      return 'Сервис не настроен. Обратитесь к разработчику.';
    default:
      return apiMessage
        ? `${prefix}${sanitizeApiMessage(apiMessage)}`
        : `${prefix}Ошибка API${status ? ` (${status})` : ''}.`;
  }
}

/** Убрать HTML и слишком длинные технические тексты */
function sanitizeApiMessage(message: string): string {
  const clean = message.replace(/\s+/g, ' ').trim();
  if (clean.startsWith('<') || clean.length > 220) {
    return 'Техническая ошибка API';
  }
  return clean;
}

/** HTTP-ошибка от Grok / OpenAI */
export function parseHttpApiError(
  provider: string,
  status: number,
  bodyText = '',
): ApiError {
  const apiMessage = extractApiErrorMessage(bodyText);
  const code = mapStatusToCode(status, apiMessage);
  const retryable = code === 'rate_limit' || code === 'server_error';

  return new ApiError({
    code,
    status,
    provider,
    retryable,
    userMessage: buildUserMessage(code, provider, status, apiMessage),
      debugMessage: apiMessage ?? (bodyText.slice(0, 300) || `HTTP ${status}`),
  });
}

/** Сетевая / fetch ошибка */
export function parseNetworkApiError(provider: string, error: unknown): ApiError {
  const msg = error instanceof Error ? error.message : String(error);
  const lower = msg.toLowerCase();

  const code: ApiErrorCode =
    lower.includes('timeout') || lower.includes('aborted')
      ? 'timeout'
      : lower.includes('failed to fetch') ||
          lower.includes('network') ||
          lower.includes('networkerror')
        ? 'network'
        : 'unknown';

  return new ApiError({
    code,
    provider,
    retryable: code === 'network' || code === 'timeout',
    userMessage: buildUserMessage(code, provider),
    debugMessage: msg,
  });
}

/** JSON.parse из ответа AI */
export function parseJsonApiError(provider: string, error: unknown): ApiError {
  const msg = error instanceof Error ? error.message : String(error);

  return new ApiError({
    code: 'parse_error',
    provider,
    retryable: false,
    userMessage: buildUserMessage('parse_error', provider),
    debugMessage: msg,
  });
}

/** Любая ошибка → текст для UI */
export function formatApiErrorForUser(error: unknown, fallback = 'Ошибка загрузки'): string {
  if (isApiError(error)) {
    return error.userMessage;
  }

  const msg = error instanceof Error ? error.message : String(error);

  if (/window is not defined|document is not defined|ServiceWorker/i.test(msg)) {
    return fallback;
  }

  if (/failed to fetch|networkerror|network error/i.test(msg)) {
    return 'Нет подключения к интернету. Проверьте сеть.';
  }

  if (/401|unauthorized|invalid.*api.*key/i.test(msg)) {
    return 'Неверный API-ключ. Проверьте настройки.';
  }

  if (/429|rate limit|too many requests/i.test(msg)) {
    return 'Слишком много запросов. Подождите и повторите.';
  }

  if (/quota|insufficient/i.test(msg)) {
    return 'Закончился баланс API. Пополните счёт провайдера.';
  }

  if (msg.length > 240 || msg.includes('<!DOCTYPE')) {
    return fallback;
  }

  return msg || fallback;
}

/** Не повторять fallback на другой провайдер при этих кодах? 
 *  При invalid_key на одном — второй провайдер всё ещё может сработать. */
export function shouldSkipProviderFallback(error: unknown): boolean {
  return isApiError(error) && error.code === 'insufficient_quota';
}
