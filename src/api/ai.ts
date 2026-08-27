/**
 * AI API для PriceGuard AI.
 *
 * ВАЖНО: ключи Grok/OpenAI больше НЕ хранятся в расширении.
 * Все запросы идут через серверный прокси — Supabase Edge Function `ai-proxy`,
 * где ключи лежат в secrets. Клиент лишь выбирает приоритетного провайдера.
 */

import { ApiError, formatApiErrorForUser } from '@/api/errors';
import { callEdge, EdgeError } from '@/lib/supabase/edge';
import { getSupabaseConfig } from '@/lib/supabase/config';
import { getDeviceId } from '@/lib/supabase/device-id';
import { AI_AUTH_REQUIRED_MESSAGE, canUseCloudFeatures } from '@/lib/supabase/auth-guard';
import { AI_REQUEST_DEFAULTS } from '@/lib/ai/schemas';
import { telemetry } from '@/lib/telemetry/log';
import { trackAiStarted, trackAiAnalysisStarted, trackAiAnalysisFailed, classifyFailureReason } from '@/lib/telemetry/funnel';
import type { WebResearchSource } from '@/types/full-analysis';

export type AiProviderName = 'grok' | 'openai';
export type AiPriority = AiProviderName;

export interface AiApiSettings {
  /** @deprecated ключи хранятся на сервере */
  grokKey: string;
  /** @deprecated ключи хранятся на сервере */
  openaiKey: string;
  priority: AiPriority;
}

export interface SendToAiOptions {
  jsonMode?: boolean;
  /** @deprecated ключ больше не передаётся с клиента */
  apiKey?: string;
  temperature?: number;
  maxTokens?: number;
  /** @deprecated use sendFullAnalysisViaProxy with webResearch */
  fullAnalysis?: boolean;
}

export type AiPipeline = 'single' | 'lite' | 'sonar_gpt';

export interface SendToAiResult {
  text: string;
  providerUsed: AiProviderName;
  pipeline?: AiPipeline;
  webResearchUsed?: boolean;
  webResearchCached?: boolean;
  webResearchText?: string;
  webSources?: WebResearchSource[];
}

export interface CachedWebResearchPayload {
  text: string;
  sources?: WebResearchSource[];
}

export interface FullAnalysisProxyPayload {
  productTitle: string;
  productPrice?: number;
  oldPrice?: number;
  marketplace?: string;
  article?: string;
  productId?: string;
  forceRefreshWeb?: boolean;
  cachedWebResearch?: CachedWebResearchPayload;
  reviews: string[];
  totalReviewsFound?: number;
  priceHistory?: Array<{ price: number; date: string }>;
  compareOffers?: Array<{
    marketplace: string;
    price: number | null;
    rating: number | null;
    title: string;
  }>;
}

export interface TestConnectionResult {
  ok: boolean;
  message: string;
  code?: string;
  retryable?: boolean;
}

const STORAGE_KEYS = {
  priority: 'priceguard_ai_priority',
  legacyProvider: 'priceguard_ai_provider',
} as const;

const PROVIDER_LABELS: Record<AiProviderName, string> = {
  grok: 'Grok',
  openai: 'GPT',
};

// ——— Настройки (только приоритет провайдера) ———

export async function loadAiApiSettings(): Promise<AiApiSettings> {
  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.priority,
    STORAGE_KEYS.legacyProvider,
  ]);

  let priority = (stored[STORAGE_KEYS.priority] as AiPriority) || 'grok';
  const legacy = stored[STORAGE_KEYS.legacyProvider] as string | undefined;
  if (!stored[STORAGE_KEYS.priority] && (legacy === 'openai' || legacy === 'grok')) {
    priority = legacy;
  }

  return { grokKey: '', openaiKey: '', priority };
}

export async function saveAiApiSettings(settings: Partial<AiApiSettings>): Promise<void> {
  const current = await loadAiApiSettings();
  const priority = settings.priority ?? current.priority;
  await chrome.storage.local.set({
    [STORAGE_KEYS.priority]: priority,
    [STORAGE_KEYS.legacyProvider]: priority,
  });
}

/** @deprecated ключи не валидируются на клиенте — оставлено для обратной совместимости UI. */
export function isValidGrokKey(_key: string): boolean {
  return false;
}
/** @deprecated */
export function isValidOpenAiKey(_key: string): boolean {
  return false;
}

/** Доступен ли облачный AI. Теперь это = настроен ли Supabase (там лежат ключи). */
export async function hasAnyApiKey(): Promise<boolean> {
  return isCloudAiAvailable();
}

export function isCloudAiAvailable(): boolean {
  return getSupabaseConfig().configured;
}

export function getProviderLabel(provider: AiProviderName): string {
  return provider === 'grok' ? 'Grok 3 Mini' : 'GPT-4o Mini';
}

function resolveProviderOrder(settings: AiApiSettings): AiProviderName {
  return settings.priority === 'openai' ? 'openai' : 'grok';
}

function mapAiProxyErrorMessage(message: string, status?: number): string {
  if (status === 429 && /глубокого разбора|sonar_daily|веб/i.test(message)) {
    return message;
  }
  if (status === 429 || message.includes('лимит')) {
    return 'Превышен лимит AI-запросов (40 в час). Попробуйте позже.';
  }
  if (message.includes('all_providers_failed') || message.includes('AI недоступен')) {
    return 'Сейчас AI недоступен. Показан сохранённый анализ или локальная оценка.';
  }
  if (status === 502 || status === 503) {
    return 'AI-сервер временно недоступен. Повторите через минуту.';
  }
  return message || 'Ошибка AI-сервера';
}

/**
 * Отправить запрос к AI через серверный прокси.
 * Прокси сам делает fallback Grok ↔ GPT на стороне сервера.
 * @throws ApiError
 */
export async function sendToAI(
  provider: AiProviderName,
  systemPrompt: string,
  userPrompt: string,
  options: SendToAiOptions = {},
): Promise<string> {
  const result = await sendViaProxy(provider, systemPrompt, userPrompt, options);
  return result.text;
}

async function sendViaProxy(
  provider: AiProviderName,
  systemPrompt: string,
  userPrompt: string,
  options: SendToAiOptions,
): Promise<SendToAiResult> {
  if (!isCloudAiAvailable()) {
    throw new ApiError({
      code: 'not_configured',
      retryable: false,
      userMessage: 'AI-сервер не настроен. Обратитесь к разработчику расширения.',
    });
  }

  if (!(await canUseCloudFeatures())) {
    throw new ApiError({
      code: 'unauthorized',
      retryable: false,
      userMessage: AI_AUTH_REQUIRED_MESSAGE,
    });
  }

  let deviceId = '';
  try {
    deviceId = await getDeviceId();
  } catch {
    deviceId = '';
  }

  try {
    const aiStarted = Date.now();
    const promptChars = systemPrompt.length + userPrompt.length;
    const data = await callEdge<{
      ok: boolean;
      text?: string;
      provider?: AiProviderName;
      error?: string;
      code?: string;
      pipeline?: 'single' | 'sonar_gpt';
      webResearchUsed?: boolean;
    }>('ai-proxy', {
      provider,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: options.temperature ?? AI_REQUEST_DEFAULTS.temperature,
      max_tokens: options.maxTokens,
      jsonMode: options.jsonMode ?? AI_REQUEST_DEFAULTS.jsonMode,
      deviceId,
      fullAnalysis: false,
    });

    const text = data.text ?? '';
    if (!text.trim()) {
      telemetry.warn({
        stage: 'ai',
        name: 'AI_EMPTY',
        success: false,
        elapsedMs: Date.now() - aiStarted,
        errorCode: 'empty_response',
        data: { provider, promptChars, fullAnalysis: false },
      });
      throw new ApiError({
        code: 'empty_response',
        provider: 'AI',
        retryable: true,
        userMessage: 'AI вернул пустой ответ. Попробуйте ещё раз.',
      });
    }
    telemetry.info({
      stage: 'ai',
      name: 'AI_SUCCESS',
      success: true,
      elapsedMs: Date.now() - aiStarted,
      data: {
        provider: data.provider ?? provider,
        pipeline: data.pipeline ?? 'single',
        promptChars,
        completionChars: text.length,
        fullAnalysis: false,
      },
    });
    return {
      text,
      providerUsed: (data.provider as AiProviderName) ?? provider,
      pipeline: data.pipeline ?? 'single',
      webResearchUsed: Boolean(data.webResearchUsed),
    };
  } catch (error) {
    if (!(error instanceof ApiError)) {
      telemetry.error({
        stage: 'ai',
        name: 'AI_FAILED',
        success: false,
        errorCode: error instanceof EdgeError ? String(error.status ?? 'edge') : 'ai_error',
        error,
        data: { provider, fullAnalysis: false },
      });
    }
    if (error instanceof ApiError) throw error;
    if (error instanceof EdgeError) {
      const retryable = error.status === 429 || error.status === 502 || error.status === 503;
      const code =
        error.status === 429
          ? 'rate_limit'
          : error.code === 'all_providers_failed'
            ? 'server_error'
            : 'unknown';
      throw new ApiError({
        code,
        provider: 'AI',
        retryable,
        userMessage: mapAiProxyErrorMessage(error.message, error.status),
        debugMessage: error.code,
      });
    }
    throw new ApiError({
      code: 'network',
      provider: 'AI',
      retryable: true,
      userMessage: 'Не удалось связаться с AI-сервером. Проверьте интернет.',
      debugMessage: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Запрос с приоритетным провайдером. Fallback выполняется на сервере (ai-proxy).
 * @throws ApiError с понятным userMessage
 */
export async function sendToAIWithFallback(
  systemPrompt: string,
  userPrompt: string,
  options: SendToAiOptions = {},
): Promise<SendToAiResult> {
  const settings = await loadAiApiSettings();
  const provider = resolveProviderOrder(settings);
  return sendViaProxy(provider, systemPrompt, userPrompt, options);
}

/**
 * Глубокий разбор: ai-proxy Sonar → GPT (только при webResearch; кэш v3 пропускает Sonar).
 * @throws ApiError
 */
export async function sendFullAnalysisViaProxy(
  payload: FullAnalysisProxyPayload,
  options: { webResearch?: boolean } = {},
): Promise<SendToAiResult> {
  if (!isCloudAiAvailable()) {
    throw new ApiError({
      code: 'not_configured',
      retryable: false,
      userMessage: 'AI-сервер не настроен. Обратитесь к разработчику расширения.',
    });
  }

  if (!(await canUseCloudFeatures())) {
    throw new ApiError({
      code: 'unauthorized',
      retryable: false,
      userMessage: AI_AUTH_REQUIRED_MESSAGE,
    });
  }

  let deviceId = '';
  try {
    deviceId = await getDeviceId();
  } catch {
    deviceId = '';
  }

  const settings = await loadAiApiSettings();
  const provider = resolveProviderOrder(settings);
  const webResearch = options.webResearch !== false;

  trackAiAnalysisStarted();

  try {
    const aiStarted = Date.now();
    const data = await callEdge<{
      ok: boolean;
      text?: string;
      provider?: AiProviderName;
      error?: string;
      code?: string;
      pipeline?: AiPipeline;
      webResearchUsed?: boolean;
      webResearchCached?: boolean;
      webResearchText?: string;
      webSources?: WebResearchSource[];
    }>('ai-proxy', {
      provider,
      fullAnalysis: true,
      webResearch,
      pipeline: webResearch ? 'sonar_gpt' : 'lite',
      temperature: AI_REQUEST_DEFAULTS.temperature,
      deviceId,
      payload,
    });

    const text = data.text ?? '';
    if (!text.trim()) {
      telemetry.warn({
        stage: 'ai',
        name: 'AI_EMPTY',
        success: false,
        elapsedMs: Date.now() - aiStarted,
        errorCode: 'empty_response',
        data: { fullAnalysis: true, webResearch, provider },
      });
      throw new ApiError({
        code: 'empty_response',
        provider: 'AI',
        retryable: true,
        userMessage: 'AI вернул пустой ответ. Попробуйте ещё раз.',
      });
    }

    telemetry.info({
      stage: 'ai',
      name: data.webResearchCached ? 'AI_CACHE_HIT' : 'AI_SUCCESS',
      success: true,
      elapsedMs: Date.now() - aiStarted,
      data: {
        provider: data.provider ?? 'openai',
        pipeline: data.pipeline ?? (webResearch ? 'sonar_gpt' : 'lite'),
        completionChars: text.length,
        fullAnalysis: true,
        webResearch,
        webResearchUsed: Boolean(data.webResearchUsed),
        webResearchCached: Boolean(data.webResearchCached),
      },
    });
    void trackAiStarted({
      mode: 'full',
      cache: data.webResearchCached ? 'hit' : 'miss',
      provider: data.provider ?? 'openai',
    });

    return {
      text,
      providerUsed: (data.provider as AiProviderName) ?? 'openai',
      pipeline: data.pipeline ?? (webResearch ? 'sonar_gpt' : 'lite'),
      webResearchUsed: Boolean(data.webResearchUsed),
      webResearchCached: Boolean(data.webResearchCached),
      webResearchText: data.webResearchText,
      webSources: data.webSources,
    };
  } catch (error) {
    trackAiAnalysisFailed(
      classifyFailureReason(error),
      error instanceof ApiError ? error.provider : undefined,
    );
    if (!(error instanceof ApiError)) {
      telemetry.error({
        stage: 'ai',
        name: 'AI_FAILED',
        success: false,
        error,
        data: { fullAnalysis: true, webResearch },
      });
    }
    if (error instanceof ApiError) throw error;
    if (error instanceof EdgeError) {
      const retryable = error.status === 429 || error.status === 502 || error.status === 503;
      throw new ApiError({
        code: error.status === 429 ? 'rate_limit' : 'unknown',
        provider: 'AI',
        retryable,
        userMessage: mapAiProxyErrorMessage(error.message, error.status),
        debugMessage: error.code,
      });
    }
    throw new ApiError({
      code: 'network',
      provider: 'AI',
      retryable: true,
      userMessage: 'Не удалось связаться с AI-сервером. Проверьте интернет.',
      debugMessage: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Распарсить JSON из ответа AI */
export function parseAiJson<T>(text: string, provider = 'AI'): T {
  const trimmed = text.trim();
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);

  if (!jsonMatch) {
    throw new ApiError({
      code: 'parse_error',
      provider,
      retryable: false,
      userMessage: `${provider}: не удалось разобрать ответ. Повторите анализ.`,
      debugMessage: `No JSON in: ${trimmed.slice(0, 120)}`,
    });
  }

  try {
    return JSON.parse(jsonMatch[0]) as T;
  } catch (error) {
    throw new ApiError({
      code: 'parse_error',
      provider,
      retryable: false,
      userMessage: `${provider}: ответ повреждён. Повторите анализ.`,
      debugMessage: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function testAiConnection(provider: AiProviderName): Promise<TestConnectionResult> {
  const label = PROVIDER_LABELS[provider];

  if (!isCloudAiAvailable()) {
    return {
      ok: false,
      message: 'AI-сервер (Supabase) не настроен в сборке расширения.',
      code: 'not_configured',
      retryable: false,
    };
  }

  try {
    const reply = await sendToAI(
      provider,
      'You are a connection test assistant.',
      'Reply with exactly one word: OK',
      { jsonMode: false, maxTokens: 16 },
    );
    const ok = reply.toLowerCase().includes('ok');
    return {
      ok: true,
      message: ok ? `${label}: подключение успешно` : `${label}: ответ получен`,
    };
  } catch (error) {
    const apiErr = error instanceof ApiError ? error : null;
    return {
      ok: false,
      message: apiErr?.userMessage ?? formatApiErrorForUser(error, 'ошибка AI'),
      code: apiErr?.code,
      retryable: apiErr?.retryable,
    };
  }
}

export { formatApiErrorForUser, ApiError };
