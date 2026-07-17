// PriceGuard AI — AI proxy (AITunnel).
//
// Режимы:
//   1) Обычный chat: Grok ↔ GPT-4o mini fallback (Free / простые запросы)
//   2) fullAnalysis: true → двухшаговый pipeline Sonar → GPT-4o mini (Premium)
//
// Secrets: AITUNNEL_API_KEY, GROK_API_KEY, OPENAI_API_KEY
//          AI_RATE_LIMIT_MAX (40), AI_RATE_LIMIT_WINDOW_MIN (60)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { corsHeaders, jsonResponse } from '../_shared/utils.ts';
import { requireAuthUser } from '../_shared/auth.ts';

type Provider = 'grok' | 'openai' | 'perplexity';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface WebSource {
  title: string;
  url: string;
}

interface FullAnalysisPayload {
  productTitle: string;
  productPrice?: number;
  oldPrice?: number;
  marketplace?: string;
  article?: string;
  productId?: string;
  forceRefreshWeb?: boolean;
  cachedWebResearch?: { text: string; sources?: WebSource[] };
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

const WEB_RESEARCH_CACHE_VERSION = 3;
const WEB_RESEARCH_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const VALID_MARKETPLACES = ['wildberries', 'ozon', 'yandex_market'];

const AITUNNEL_URL = 'https://api.aitunnel.ru/v1/chat/completions';

const DIRECT_ENDPOINTS: Record<'grok' | 'openai', string> = {
  grok: 'https://api.x.ai/v1/chat/completions',
  openai: 'https://api.openai.com/v1/chat/completions',
};

const MODELS: Record<Provider, string> = {
  grok: 'grok-3-mini',
  openai: 'gpt-4o-mini',
  perplexity: 'sonar',
};

const PROVIDER_LABELS: Record<Provider, string> = {
  grok: 'Grok 3 Mini',
  openai: 'GPT-4o Mini',
  perplexity: 'Perplexity Sonar',
};

const DIRECT_SECRET_ENV: Record<'grok' | 'openai', string> = {
  grok: 'GROK_API_KEY',
  openai: 'OPENAI_API_KEY',
};

const DEFAULT_TEMPERATURE = 0.2;

const WEB_RESEARCH_SYSTEM = `Ты — исследователь товаров для российских покупателей.
Найди в интернете обзоры, сравнения и типичные мнения о товаре.
Пиши кратко на русском (до 450 слов). Не выдумывай факты без источников.
Структура ответа:
1) Репутация модели
2) Плюсы из обзоров
3) Минусы / известные проблемы
4) С чем сравнивают / альтернативы
5) Краткий вывод`;

const FULL_ANALYSIS_SYSTEM = `Ты — эксперт по покупкам на российских маркетплейсах (Wildberries, Ozon, Яндекс.Маркет).

Задача:
1. Проанализировать отзывы покупателей с карточки товара.
2. Если дан блок «Данные из интернета» — использовать его для webOverview и alternatives.
3. Если веб-данных нет — опирайся только на отзывы и название (не выдумывай обзоры).
4. Выдать короткую рекомендацию по покупке (2–4 предложения).
5. Предложить 2–3 альтернативы в той же категории (если уместно).

Верни ТОЛЬКО валидный JSON без markdown. Все поля обязательны:

{
  "qualityScore": <1-10>,
  "qualitySummary": "<string>",
  "webOverview": "<string>",
  "pros": ["..."],
  "cons": ["..."],
  "fakeRisk": "low" | "medium" | "high",
  "fakeRiskExplanation": "<string>",
  "analogComparison": "<string>",
  "alternatives": [{ "name": "<string>", "reason": "<string>" }],
  "verdict": "buy_now" | "wait_discount" | "not_recommended",
  "verdictExplanation": "<string>",
  "keySpecs": ["..."],
  "hiddenProblems": ["..."],
  "priceInsight": "<string>"
}

Пиши на русском.`;

function serviceClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
}

async function isRateLimited(
  supabase: ReturnType<typeof serviceClient>,
  key: string,
  column: 'user_id' | 'device_id',
  /** Premium pipeline = 2 API calls → считаем как 2 к лимиту заранее */
  cost = 1,
): Promise<boolean> {
  const max = Number(Deno.env.get('AI_RATE_LIMIT_MAX') ?? '40');
  const windowMin = Number(Deno.env.get('AI_RATE_LIMIT_WINDOW_MIN') ?? '60');
  if (!key || max <= 0) return false;

  const since = new Date(Date.now() - windowMin * 60_000).toISOString();
  const { count, error } = await supabase
    .from('ai_request_log')
    .select('id', { count: 'exact', head: true })
    .eq(column, key)
    .gte('created_at', since);

  if (error) {
    console.error('rate limit check failed', error);
    return false;
  }
  return (count ?? 0) + cost > max;
}

async function logRequest(
  supabase: ReturnType<typeof serviceClient>,
  entry: {
    userId?: string | null;
    deviceId?: string | null;
    provider: Provider;
    model: string;
    success: boolean;
    error?: string;
    durationMs: number;
    promptTokens?: number;
    completionTokens?: number;
    pipeline?: string;
    webResearchUsed?: boolean;
    webResearchCached?: boolean;
  },
): Promise<void> {
  try {
    await supabase.from('ai_request_log').insert({
      user_id: entry.userId || null,
      device_id: entry.deviceId || null,
      provider: entry.provider,
      model: entry.model,
      success: entry.success,
      error: entry.error ? entry.error.slice(0, 500) : null,
      duration_ms: entry.durationMs,
      prompt_tokens: entry.promptTokens ?? null,
      completion_tokens: entry.completionTokens ?? null,
      pipeline: entry.pipeline ?? null,
      web_research_used: entry.webResearchUsed ?? null,
      web_research_cached: entry.webResearchCached ?? null,
    });
  } catch (e) {
    console.error('ai_request_log insert failed', e);
  }
}

function extractJsonObject(text: string): string | null {
  const trimmed = text.trim();
  const match = trimmed.match(/\{[\s\S]*\}/);
  return match?.[0] ?? null;
}

function isValidJsonResponse(text: string, jsonMode: boolean): boolean {
  if (!jsonMode) return Boolean(text.trim());
  const json = extractJsonObject(text);
  if (!json) return false;
  try {
    JSON.parse(json);
    return true;
  } catch {
    return false;
  }
}

function extractUrlCitations(annotations: unknown): WebSource[] {
  if (!Array.isArray(annotations)) return [];
  const seen = new Set<string>();
  const out: WebSource[] = [];
  for (const ann of annotations) {
    if (!ann || typeof ann !== 'object') continue;
    const item = ann as { type?: string; url_citation?: { url?: string; title?: string } };
    if (item.type !== 'url_citation') continue;
    const url = item.url_citation?.url;
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const title = item.url_citation?.title?.trim() || url;
    out.push({ title: title.slice(0, 200), url: url.slice(0, 500) });
  }
  return out.slice(0, 12);
}

function parseSonarResponse(raw: string): {
  text: string;
  model: string;
  sources: WebSource[];
  promptTokens?: number;
  completionTokens?: number;
} {
  const data = JSON.parse(raw) as {
    model?: string;
    choices?: Array<{
      message?: { content?: string; annotations?: unknown };
    }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const message = data.choices?.[0]?.message;
  const text = message?.content ?? '';
  if (!text.trim()) throw new Error('empty_response');
  return {
    text,
    model: data.model ?? 'unknown',
    sources: extractUrlCitations(message?.annotations),
    promptTokens: data.usage?.prompt_tokens,
    completionTokens: data.usage?.completion_tokens,
  };
}

function parseCompletionResponse(raw: string): {
  text: string;
  model: string;
  promptTokens?: number;
  completionTokens?: number;
} {
  const data = JSON.parse(raw) as {
    model?: string;
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const text = data.choices?.[0]?.message?.content ?? '';
  if (!text.trim()) throw new Error('empty_response');
  return {
    text,
    model: data.model ?? 'unknown',
    promptTokens: data.usage?.prompt_tokens,
    completionTokens: data.usage?.completion_tokens,
  };
}

async function postChatCompletion(
  url: string,
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  temperature: number,
  maxTokens: number | undefined,
  jsonMode: boolean,
  extraBody?: Record<string, unknown>,
): Promise<{ text: string; model: string; promptTokens?: number; completionTokens?: number }> {
  const body: Record<string, unknown> = {
    model,
    temperature,
    messages,
    ...extraBody,
  };
  if (jsonMode) body.response_format = { type: 'json_object' };
  if (maxTokens) body.max_tokens = maxTokens;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`provider_${response.status}:${raw.slice(0, 200)}`);
  }

  const parsed = parseCompletionResponse(raw);
  return { ...parsed, model: parsed.model === 'unknown' ? model : parsed.model };
}

async function callProvider(
  provider: Provider,
  messages: ChatMessage[],
  temperature: number,
  maxTokens: number | undefined,
  jsonMode: boolean,
  extraBody?: Record<string, unknown>,
): Promise<{ text: string; model: string; promptTokens?: number; completionTokens?: number }> {
  const model = MODELS[provider];
  const aitunnelKey = Deno.env.get('AITUNNEL_API_KEY');

  if (aitunnelKey) {
    return postChatCompletion(
      AITUNNEL_URL,
      aitunnelKey,
      model,
      messages,
      temperature,
      maxTokens,
      jsonMode,
      extraBody,
    );
  }

  if (provider === 'perplexity') {
    throw new Error('missing_secret:AITUNNEL_API_KEY');
  }

  const directKey = Deno.env.get(DIRECT_SECRET_ENV[provider]);
  if (!directKey) {
    throw new Error(`missing_secret:${DIRECT_SECRET_ENV[provider]}`);
  }

  return postChatCompletion(
    DIRECT_ENDPOINTS[provider],
    directKey,
    model,
    messages,
    temperature,
    maxTokens,
    jsonMode,
    extraBody,
  );
}

const SONAR_EXTRA_BODY = {
  web_search_options: { search_context_size: 'low' },
};

async function callSonar(
  messages: ChatMessage[],
  temperature: number,
  maxTokens: number,
): Promise<{
  text: string;
  model: string;
  sources: WebSource[];
  promptTokens?: number;
  completionTokens?: number;
}> {
  const model = MODELS.perplexity;
  const aitunnelKey = Deno.env.get('AITUNNEL_API_KEY');
  if (!aitunnelKey) {
    throw new Error('missing_secret:AITUNNEL_API_KEY');
  }

  const body: Record<string, unknown> = {
    model,
    temperature,
    messages,
    max_tokens: maxTokens,
    ...SONAR_EXTRA_BODY,
  };

  const response = await fetch(AITUNNEL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${aitunnelKey}`,
    },
    body: JSON.stringify(body),
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`provider_${response.status}:${raw.slice(0, 200)}`);
  }

  const parsed = parseSonarResponse(raw);
  return { ...parsed, model: parsed.model === 'unknown' ? model : parsed.model };
}

function isWebResearchFresh(lastUpdated: string | null | undefined): boolean {
  if (!lastUpdated) return false;
  const ts = Date.parse(lastUpdated);
  if (!Number.isFinite(ts)) return false;
  return Date.now() - ts < WEB_RESEARCH_TTL_MS;
}

async function loadWebResearchFromServerCache(
  supabase: ReturnType<typeof serviceClient>,
  marketplace: string,
  productId: string,
): Promise<{ text: string; sources: WebSource[] } | null> {
  if (!VALID_MARKETPLACES.includes(marketplace) || !productId) return null;

  const { data, error } = await supabase
    .from('product_cache')
    .select('ai_analysis, last_updated')
    .eq('marketplace', marketplace)
    .eq('product_id', productId)
    .eq('cache_version', WEB_RESEARCH_CACHE_VERSION)
    .maybeSingle();

  if (error || !data || !isWebResearchFresh(data.last_updated)) return null;

  const cached = data.ai_analysis as { text?: string; sources?: WebSource[] } | null;
  if (!cached?.text?.trim() || cached.text.trim().length <= 40) return null;

  return {
    text: cached.text.trim(),
    sources: Array.isArray(cached.sources) ? cached.sources : [],
  };
}

async function saveWebResearchToServerCache(
  supabase: ReturnType<typeof serviceClient>,
  payload: FullAnalysisPayload,
  text: string,
  sources: WebSource[],
): Promise<void> {
  const marketplace = payload.marketplace ?? '';
  const productId = payload.productId ?? '';
  if (!VALID_MARKETPLACES.includes(marketplace) || !productId || !text.trim()) return;

  try {
    await supabase.from('product_cache').upsert(
      {
        marketplace,
        product_id: productId,
        product_title: payload.productTitle?.slice(0, 500) ?? null,
        model: 'sonar',
        ai_analysis: { text: text.trim(), sources },
        last_updated: new Date().toISOString(),
        cache_version: WEB_RESEARCH_CACHE_VERSION,
      },
      { onConflict: 'marketplace,product_id,cache_version' },
    );
  } catch (e) {
    console.error('web research cache save failed', e);
  }
}

/** Есть ли свежий кэш веб-исследования (для rate limit: 1 вместо 2). */
async function willUseCachedWebResearch(
  supabase: ReturnType<typeof serviceClient>,
  payload: FullAnalysisPayload,
): Promise<boolean> {
  if (payload.forceRefreshWeb) return false;

  const clientCached = payload.cachedWebResearch?.text?.trim();
  if (clientCached && clientCached.length > 40) return true;

  const marketplace = payload.marketplace ?? '';
  const productId = payload.productId ?? '';
  if (!marketplace || !productId) return false;

  const server = await loadWebResearchFromServerCache(supabase, marketplace, productId);
  return Boolean(server?.text);
}

function buildWebResearchUser(payload: FullAnalysisPayload): string {
  return [
    `Товар: ${payload.productTitle}`,
    payload.article ? `Артикул: ${payload.article}` : null,
    payload.marketplace ? `Маркетплейс карточки: ${payload.marketplace}` : null,
    payload.productPrice ? `Цена на карточке: ${payload.productPrice} ₽` : null,
    '',
    'Найди актуальные обзоры и мнения в сети (не только отзывы маркетплейса).',
  ]
    .filter((line) => line !== null)
    .join('\n');
}

function buildFullAnalysisUser(payload: FullAnalysisPayload, webResearch?: string): string {
  const lines = [
    `Товар: ${payload.productTitle}`,
    payload.article ? `Артикул: ${payload.article}` : null,
    payload.marketplace ? `Маркетплейс: ${payload.marketplace}` : null,
    payload.productPrice ? `Цена: ${payload.productPrice} ₽` : null,
    payload.oldPrice ? `Старая цена: ${payload.oldPrice} ₽` : null,
    `Отзывов для анализа: ${payload.reviews.length} (всего: ${payload.totalReviewsFound ?? payload.reviews.length})`,
  ].filter(Boolean);

  if (payload.priceHistory?.length) {
    lines.push(
      'История цен:',
      ...payload.priceHistory.slice(-10).map((p) => `  ${p.date}: ${p.price} ₽`),
    );
  }

  if (payload.compareOffers?.length) {
    lines.push('Цены на других площадках:');
    for (const o of payload.compareOffers) {
      lines.push(
        `  ${o.marketplace}: ${o.price ?? '—'} ₽, рейтинг ${o.rating ?? '—'}, ${(o.title ?? '').slice(0, 60)}`,
      );
    }
  }

  if (webResearch?.trim()) {
    lines.push('', 'Данные из интернета (Perplexity Sonar):', webResearch.trim().slice(0, 3_500));
  }

  const reviewsBlock = (payload.reviews ?? [])
    .slice(0, 20)
    .map((r, i) => `--- Отзыв ${i + 1} ---\n${String(r).slice(0, 500)}`)
    .join('\n\n');

  return `${lines.join('\n')}\n\nОтзывы покупателей:\n\n${reviewsBlock}`;
}

function userFacingError(code: string, lastError: string): string {
  if (code === 'rate_limit') {
    return 'Превышен лимит AI-запросов (40 в час). Попробуйте позже.';
  }
  if (code === 'all_providers_failed') {
    return 'Сейчас AI недоступен. Показан сохранённый анализ или локальная оценка.';
  }
  if (lastError.includes('missing_secret')) {
    return 'AI не настроен на сервере. Задайте AITUNNEL_API_KEY в Supabase.';
  }
  return `AI недоступен: ${PROVIDER_LABELS.grok} и ${PROVIDER_LABELS.openai} не ответили.`;
}

/** Free / простой chat: Grok ↔ GPT fallback */
async function handleSingleChat(params: {
  supabase: ReturnType<typeof serviceClient>;
  provider: 'grok' | 'openai';
  messages: ChatMessage[];
  temperature: number;
  maxTokens?: number;
  jsonMode: boolean;
  userId: string | null;
  deviceId: string;
  started: number;
}): Promise<Response> {
  const order: Array<'grok' | 'openai'> =
    params.provider === 'grok' ? ['grok', 'openai'] : ['openai', 'grok'];
  const errors: string[] = [];

  for (const p of order) {
    try {
      const { text, model, promptTokens, completionTokens } = await callProvider(
        p,
        params.messages,
        params.temperature,
        params.maxTokens,
        params.jsonMode,
      );

      if (!isValidJsonResponse(text, params.jsonMode)) {
        throw new Error('invalid_json_response');
      }

      await logRequest(params.supabase, {
        userId: params.userId,
        deviceId: params.deviceId,
        provider: p,
        model,
        success: true,
        durationMs: Date.now() - params.started,
        promptTokens,
        completionTokens,
        pipeline: 'single',
      });
      return jsonResponse({ ok: true, text, provider: p, model, pipeline: 'single' });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${p}: ${msg}`);
      await logRequest(params.supabase, {
        userId: params.userId,
        deviceId: params.deviceId,
        provider: p,
        model: MODELS[p],
        success: false,
        error: msg,
        durationMs: Date.now() - params.started,
      });
    }
  }

  const lastError = errors.join(' | ');
  return jsonResponse(
    {
      ok: false,
      code: 'all_providers_failed',
      error: userFacingError('all_providers_failed', lastError),
      debug: lastError.slice(0, 300),
    },
    502,
  );
}

/**
 * Premium pipeline: Sonar (web) → GPT-4o mini (JSON).
 * Если Sonar упал — GPT всё равно делает анализ только по отзывам (graceful degrade).
 */
async function handleFullAnalysisPipeline(params: {
  supabase: ReturnType<typeof serviceClient>;
  payload: FullAnalysisPayload;
  temperature: number;
  userId: string | null;
  deviceId: string;
  started: number;
  preferredProvider: 'grok' | 'openai';
}): Promise<Response> {
  const payload = params.payload;
  const reviews = Array.isArray(payload.reviews) ? payload.reviews : [];
  if (reviews.length < 5) {
    return jsonResponse(
      {
        ok: false,
        code: 'bad_request',
        error: `Недостаточно отзывов (${reviews.length}). Нужно минимум 5.`,
      },
      400,
    );
  }

  let webResearch = '';
  let webSources: WebSource[] = [];
  let webUsed = false;
  let webCached = false;
  let webError = '';

  // ——— Шаг 1: Perplexity Sonar (или кэш 7 дней) ———
  const clientCache = payload.forceRefreshWeb ? null : payload.cachedWebResearch;
  if (clientCache?.text?.trim() && clientCache.text.trim().length > 40) {
    webResearch = clientCache.text.trim();
    webSources = Array.isArray(clientCache.sources) ? clientCache.sources : [];
    webUsed = true;
    webCached = true;
  } else if (!payload.forceRefreshWeb && payload.marketplace && payload.productId) {
    const serverCache = await loadWebResearchFromServerCache(
      params.supabase,
      payload.marketplace,
      payload.productId,
    );
    if (serverCache) {
      webResearch = serverCache.text;
      webSources = serverCache.sources;
      webUsed = true;
      webCached = true;
    }
  }

  if (!webUsed) {
    try {
      const sonar = await callSonar(
        [
          { role: 'system', content: WEB_RESEARCH_SYSTEM },
          { role: 'user', content: buildWebResearchUser(params.payload) },
        ],
        0.2,
        700,
      );

      webResearch = sonar.text.trim();
      webSources = sonar.sources;
      webUsed = webResearch.length > 40;

      if (webUsed) {
        await saveWebResearchToServerCache(params.supabase, params.payload, webResearch, webSources);
      }

      await logRequest(params.supabase, {
        userId: params.userId,
        deviceId: params.deviceId,
        provider: 'perplexity',
        model: sonar.model,
        success: true,
        durationMs: Date.now() - params.started,
        promptTokens: sonar.promptTokens,
        completionTokens: sonar.completionTokens,
        pipeline: 'sonar_gpt',
        webResearchUsed: webUsed,
        webResearchCached: false,
      });
    } catch (e) {
      webError = e instanceof Error ? e.message : String(e);
      await logRequest(params.supabase, {
        userId: params.userId,
        deviceId: params.deviceId,
        provider: 'perplexity',
        model: MODELS.perplexity,
        success: false,
        error: webError,
        durationMs: Date.now() - params.started,
        pipeline: 'sonar_gpt',
        webResearchUsed: false,
        webResearchCached: false,
      });
    }
  }

  // ——— Шаг 2: GPT-4o mini (с fallback на Grok) ———
  const synthesisMessages: ChatMessage[] = [
    { role: 'system', content: FULL_ANALYSIS_SYSTEM },
    {
      role: 'user',
      content: buildFullAnalysisUser(
        { ...payload, reviews },
        webUsed ? webResearch : undefined,
      ),
    },
  ];

  const order: Array<'openai' | 'grok'> =
    params.preferredProvider === 'grok' ? ['openai', 'grok'] : ['openai', 'grok'];
  // Для финального JSON предпочитаем GPT-4o mini (стабильный jsonMode), Grok — запасной
  const errors: string[] = [];

  for (const p of order) {
    try {
      const result = await callProvider(p, synthesisMessages, params.temperature, 1_000, true);

      if (!isValidJsonResponse(result.text, true)) {
        throw new Error('invalid_json_response');
      }

      await logRequest(params.supabase, {
        userId: params.userId,
        deviceId: params.deviceId,
        provider: p,
        model: result.model,
        success: true,
        durationMs: Date.now() - params.started,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
        pipeline: 'sonar_gpt',
        webResearchUsed: webUsed,
        webResearchCached: webCached,
      });

      return jsonResponse({
        ok: true,
        text: result.text,
        provider: p,
        model: result.model,
        pipeline: 'sonar_gpt',
        webResearchUsed: webUsed,
        webResearchCached: webCached,
        webResearchText: webUsed ? webResearch : undefined,
        webResearchPreview: webUsed ? webResearch.slice(0, 280) : undefined,
        webSources: webUsed ? webSources : undefined,
        webError: webUsed ? undefined : webError || undefined,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${p}: ${msg}`);
      await logRequest(params.supabase, {
        userId: params.userId,
        deviceId: params.deviceId,
        provider: p,
        model: MODELS[p],
        success: false,
        error: msg,
        durationMs: Date.now() - params.started,
      });
    }
  }

  const lastError = errors.join(' | ');
  return jsonResponse(
    {
      ok: false,
      code: 'all_providers_failed',
      error: userFacingError('all_providers_failed', lastError),
      debug: lastError.slice(0, 300),
      webResearchUsed: webUsed,
    },
    502,
  );
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Method not allowed', code: 'bad_request' }, 405);
  }

  const started = Date.now();

  try {
    const body = await req.json();
    const fullAnalysis =
      Boolean(body.fullAnalysis) ||
      body.mode === 'full_analysis' ||
      body.mode === 'fullAnalysis';
    const provider: 'grok' | 'openai' = body.provider === 'openai' ? 'openai' : 'grok';
    const messages = Array.isArray(body.messages) ? (body.messages as ChatMessage[]) : [];
    const temperature =
      typeof body.temperature === 'number' ? body.temperature : DEFAULT_TEMPERATURE;
    const maxTokens = typeof body.max_tokens === 'number' ? body.max_tokens : undefined;
    const jsonMode = body.jsonMode !== false;
    const reqDeviceId = String(body.deviceId ?? '').slice(0, 64);
    const payload = body.payload as FullAnalysisPayload | undefined;

    console.log('[ai-proxy] incoming', {
      fullAnalysis,
      mode: body.mode ?? null,
      hasPayload: Boolean(payload),
      reviews: Array.isArray(payload?.reviews) ? payload!.reviews.length : 0,
      messages: messages.length,
    });

    if (!fullAnalysis && messages.length === 0) {
      return jsonResponse({ ok: false, error: 'messages required', code: 'bad_request' }, 400);
    }
    if (fullAnalysis && (!payload || !payload.productTitle || !Array.isArray(payload.reviews))) {
      return jsonResponse(
        { ok: false, error: 'payload with productTitle + reviews required', code: 'bad_request' },
        400,
      );
    }

    const authUser = await requireAuthUser(req, false);
    const userId = authUser?.id ?? null;
    const supabase = serviceClient();

    const rateKey = userId ?? reqDeviceId;
    const rateColumn = userId ? 'user_id' : 'device_id';
    let rateCost = fullAnalysis ? 2 : 1;
    if (fullAnalysis && payload) {
      const cachedWeb = await willUseCachedWebResearch(supabase, payload);
      if (cachedWeb) rateCost = 1;
    }

    if (rateKey && await isRateLimited(supabase, rateKey, rateColumn, rateCost)) {
      return jsonResponse(
        {
          ok: false,
          code: 'rate_limit',
          error: 'Превышен лимит AI-запросов. Попробуйте позже.',
        },
        429,
      );
    }

    if (fullAnalysis && payload) {
      return await handleFullAnalysisPipeline({
        supabase,
        payload,
        temperature,
        userId,
        deviceId: reqDeviceId,
        started,
        preferredProvider: provider,
      });
    }

    return await handleSingleChat({
      supabase,
      provider,
      messages,
      temperature,
      maxTokens,
      jsonMode,
      userId,
      deviceId: reqDeviceId,
      started,
    });
  } catch (error) {
    console.error('ai-proxy error', error);
    return jsonResponse({ ok: false, error: 'Внутренняя ошибка сервера', code: 'server_error' }, 500);
  }
});
