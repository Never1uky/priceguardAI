// PriceGuard AI — AI proxy (AITunnel).
//
// Режимы:
//   1) Обычный chat / lite fullAnalysis: Grok ↔ GPT-4o mini (без Sonar)
//   2) fullAnalysis + webResearch → pipeline Sonar → GPT-4o mini (Premium deep)
//
// Secrets: AITUNNEL_API_KEY, GROK_API_KEY, OPENAI_API_KEY
//          AI_RATE_LIMIT_MAX (40), AI_RATE_LIMIT_WINDOW_MIN (60)
//          SONAR_DAILY_CAP (5) — live Sonar calls / user / UTC day

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { corsHeaders, jsonResponse } from '../_shared/utils.ts';
import { requireAuthUser } from '../_shared/auth.ts';
import {
  getProductCacheEntry,
  upsertProductCacheVersioned,
  WEB_RESEARCH_CACHE_VERSION,
  WEB_RESEARCH_CACHE_TTL_MS,
} from '../_shared/product-cache-store.ts';
import { formatFocusAxesPromptBlock } from '../_shared/seo-category-focus.ts';
import { inferSeoCategoryFromTitle } from '../_shared/seo-category.ts';
import {
  AITUNNEL_URL,
  MODELS,
  callProvider,
  logAiRequest as logRequest,
  type ChatMessage,
  type Provider,
} from '../_shared/ai-provider.ts';

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

const WEB_RESEARCH_TTL_MS = WEB_RESEARCH_CACHE_TTL_MS;
const VALID_MARKETPLACES = ['wildberries', 'ozon', 'yandex_market'];
/** Live Perplexity Sonar calls per user per UTC day (cache hits do not count). */
const DEFAULT_SONAR_DAILY_CAP = 5;

const PROVIDER_LABELS: Record<Provider, string> = {
  grok: 'Grok 3 Mini',
  openai: 'GPT-4o Mini',
  perplexity: 'Perplexity Sonar',
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

Тон: как человек после чтения отзывов. Без рекламы и клише. Не повторяй название товара в каждом поле.
Не выдумывай характеристики — только из отзывов, title или блока «Данные из интернета».
Если данных мало — dataGaps или опусти поле. pros/cons — конкретика. alternatives — только реальные модели (0 лучше выдумки).
Без SEO-статьи и FAQ HTML.

Задача:
1. Отзывы → qualityScore, pros/cons, fakeRisk, hiddenProblems, reviewThemes.
2. Если дан блок «Данные из интернета» — webOverview и alternatives; иначе не выдумывай обзоры.
3. Короткая рекомендация (verdict + explanation).
4. audienceFit / audienceAvoid — только если обосновано.
5. priceInsight — одна фраза без прогноза цены.

Верни ТОЛЬКО валидный JSON без markdown:

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
  "priceInsight": "<string>",
  "reviewThemes": { "praise": ["..."], "complain": ["..."], "rare": ["..."] },
  "audienceFit": ["..."],
  "audienceAvoid": ["..."],
  "dataGaps": ["..."]
}

Пиши на русском. Опциональные поля можно опустить, если нет данных.`;

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

/** Live Sonar (not cache) count for user since UTC midnight. */
async function isSonarDailyCapped(
  supabase: ReturnType<typeof serviceClient>,
  userId: string | null,
): Promise<boolean> {
  if (!userId) return false;
  const max = Number(Deno.env.get('SONAR_DAILY_CAP') ?? String(DEFAULT_SONAR_DAILY_CAP));
  if (max <= 0) return false;

  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const { count, error } = await supabase
    .from('ai_request_log')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('provider', 'perplexity')
    .eq('success', true)
    .eq('web_research_used', true)
    .eq('web_research_cached', false)
    .gte('created_at', start.toISOString());

  if (error) {
    console.error('sonar daily cap check failed', error);
    return false;
  }
  return (count ?? 0) >= max;
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

  const data = await getProductCacheEntry(
    supabase,
    marketplace,
    productId,
    WEB_RESEARCH_CACHE_VERSION,
    WEB_RESEARCH_TTL_MS,
  );
  if (!data) return null;

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
    await upsertProductCacheVersioned(supabase, {
      marketplace,
      productId,
      productTitle: payload.productTitle?.slice(0, 500) ?? null,
      model: 'sonar',
      aiAnalysis: { text: text.trim(), sources },
      cacheVersion: WEB_RESEARCH_CACHE_VERSION,
    });
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

  const cat = inferSeoCategoryFromTitle(payload.productTitle ?? '');
  lines.push('', formatFocusAxesPromptBlock(cat?.slug ?? null));

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

  const reviewList = payload.reviews ?? [];
  if (reviewList.length === 0) {
    if (webResearch?.trim()) {
      lines.push(
        '',
        'На маркетплейсе нет отзывов для анализа. Опирайся на данные Sonar.',
        'fakeRisk: medium (если данных мало — укажи в fakeRiskExplanation); qualityScore — из обзоров в сети.',
      );
    }
    return lines.join('\n');
  }

  const reviewsBlock = reviewList
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
 * Premium deep pipeline: Sonar (web) → GPT-4o mini (JSON).
 * Cache-first: fresh v3 product_cache skips Sonar. Live Sonar subject to daily cap.
 * Если Sonar упал / cap — GPT всё равно делает анализ только по отзывам (graceful degrade).
 */
async function handleFullAnalysisPipeline(params: {
  supabase: ReturnType<typeof serviceClient>;
  payload: FullAnalysisPayload;
  temperature: number;
  userId: string | null;
  deviceId: string;
  started: number;
  preferredProvider: 'grok' | 'openai';
  /** false = lite JSON synthesis without Sonar */
  webResearch: boolean;
}): Promise<Response> {
  const payload = params.payload;
  const reviews = Array.isArray(payload.reviews) ? payload.reviews : [];

  let webResearch = '';
  let webSources: WebSource[] = [];
  let webUsed = false;
  let webCached = false;
  let webError = '';

  if (params.webResearch) {
    // ——— Шаг 1: Perplexity Sonar (или кэш 14 дней) ———
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
      if (await isSonarDailyCapped(params.supabase, params.userId)) {
        webError = 'sonar_daily_cap';
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
        return jsonResponse(
          {
            ok: false,
            code: 'sonar_daily_cap',
            error:
              'Дневной лимит глубокого разбора (веб) исчерпан. Используйте обычный AI-анализ или повторите завтра.',
          },
          429,
        );
      }

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
  }

  const pipeline = params.webResearch ? 'sonar_gpt' : 'lite';

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
        pipeline,
        webResearchUsed: webUsed,
        webResearchCached: webCached,
      });

      return jsonResponse({
        ok: true,
        text: result.text,
        provider: p,
        model: result.model,
        pipeline,
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
        pipeline,
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
    // Deep = Sonar→GPT only when explicitly requested (pipeline or webResearch flag).
    // Legacy: fullAnalysis alone used to imply Sonar — now defaults to lite unless webResearch.
    const webResearch =
      body.pipeline === 'sonar_gpt' ||
      body.webResearch === true ||
      body.mode === 'sonar_gpt';
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
      webResearch,
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

    const authUser = await requireAuthUser(req, true);
    const userId = authUser.id;
    const supabase = serviceClient();

    const rateKey = userId;
    const rateColumn = 'user_id';
    let rateCost = fullAnalysis && webResearch ? 2 : 1;
    if (fullAnalysis && webResearch && payload) {
      const cachedWeb = await willUseCachedWebResearch(supabase, payload);
      if (cachedWeb) rateCost = 1;
    }

    if (await isRateLimited(supabase, rateKey, rateColumn, rateCost)) {
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
        webResearch,
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
    const msg = error instanceof Error ? error.message : String(error);
    if (msg === 'auth_required' || msg === 'invalid_token') {
      return jsonResponse(
        {
          ok: false,
          code: 'auth_required',
          error: 'Войдите во вкладку «Аккаунт» для AI-анализа',
        },
        401,
      );
    }
    console.error('ai-proxy error', error);
    return jsonResponse({ ok: false, error: 'Внутренняя ошибка сервера', code: 'server_error' }, 500);
  }
});
