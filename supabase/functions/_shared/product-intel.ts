/**
 * Shared Product Intelligence — оркестратор для Telegram и (позже) Extension.
 * Cache → reviews (WB) → ai-proxy → mapping offers.
 */

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import {
  fetchMarketplacePriceDetailed,
} from './marketplace-prices.ts';
import {
  productIdLookupCandidates,
  productKey,
  stripProductIdPrefix,
  toPrefixedProductId,
} from './product-id.ts';
import type { Marketplace, ParsedProductLink } from './product-url.ts';
import { fetchWildberriesReviewsServer, guessWbImageUrl } from './wb-reviews.ts';
import { fetchOzonReviewsServer } from './ozon-reviews.ts';
import { fetchYandexMarketReviewsServer } from './ym-reviews.ts';
import { projectScraperCredentials } from './reviews-common.ts';

export const FULL_PRODUCT_CACHE_VERSION = 2;
const MIN_REVIEWS = 5;
const OTHER_MPS: Marketplace[] = ['wildberries', 'ozon', 'yandex_market'];

export interface FullProductAnalysisLike {
  qualityScore?: number;
  qualitySummary?: string;
  webOverview?: string;
  pros?: string[];
  cons?: string[];
  fakeRisk?: string;
  fakeRiskExplanation?: string;
  analogComparison?: string;
  alternatives?: Array<{ name?: string; reason?: string }>;
  verdict?: string;
  verdictExplanation?: string;
  keySpecs?: string[];
  hiddenProblems?: string[];
  priceInsight?: string;
  analyzedAt?: number;
  source?: string;
  providerLabel?: string;
}

export interface CheapOffer {
  marketplace: Marketplace;
  productId: string;
  url: string;
  price: number | null;
  title?: string;
}

export interface ProductIntelCard {
  marketplace: Marketplace;
  productId: string;
  productKey: string;
  cacheProductId: string;
  url: string;
  title: string;
  price: number | null;
  rating: number | null;
  imageUrl: string | null;
  analysis: FullProductAnalysisLike | null;
  fromCache: boolean;
  analysisStatus: 'ready' | 'missing' | 'insufficient_reviews' | 'error';
  analysisNote?: string;
  offers: CheapOffer[];
  analyzedAt: number | null;
}

function asAnalysis(raw: unknown): FullProductAnalysisLike | null {
  if (!raw || typeof raw !== 'object') return null;
  return raw as FullProductAnalysisLike;
}

function parseAnalysisJson(text: string): FullProductAnalysisLike | null {
  const trimmed = text.trim();
  try {
    return asAnalysis(JSON.parse(trimmed));
  } catch {
    const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence?.[1]) {
      try {
        return asAnalysis(JSON.parse(fence[1].trim()));
      } catch {
        // fall through
      }
    }
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return asAnalysis(JSON.parse(trimmed.slice(start, end + 1)));
      } catch {
        return null;
      }
    }
    return null;
  }
}

async function loadCacheEntry(
  supabase: SupabaseClient,
  marketplace: Marketplace,
  productId: string,
): Promise<{ analysis: FullProductAnalysisLike; cacheProductId: string; lastUpdated: string } | null> {
  const candidates = productIdLookupCandidates(marketplace, productId);
  const ttlMs = 7 * 24 * 60 * 60 * 1000;

  for (const id of candidates) {
    const { data, error } = await supabase
      .from('product_cache')
      .select('product_id, ai_analysis, last_updated, cache_version')
      .eq('marketplace', marketplace)
      .eq('product_id', id)
      .eq('cache_version', FULL_PRODUCT_CACHE_VERSION)
      .maybeSingle();

    if (error || !data?.ai_analysis) continue;
    const ts = Date.parse(String(data.last_updated ?? ''));
    if (!Number.isFinite(ts) || Date.now() - ts >= ttlMs) continue;
    const analysis = asAnalysis(data.ai_analysis);
    if (!analysis) continue;
    return {
      analysis,
      cacheProductId: String(data.product_id),
      lastUpdated: String(data.last_updated),
    };
  }
  return null;
}

async function putCacheEntry(
  supabase: SupabaseClient,
  params: {
    marketplace: Marketplace;
    productId: string;
    productTitle: string;
    reviews: string[];
    analysis: FullProductAnalysisLike;
    model?: string;
  },
): Promise<void> {
  const cacheProductId = toPrefixedProductId(params.marketplace, params.productId);
  await supabase.from('product_cache').upsert(
    {
      marketplace: params.marketplace,
      product_id: cacheProductId,
      product_title: params.productTitle.slice(0, 500),
      model: params.model ?? null,
      raw_reviews: params.reviews,
      ai_analysis: params.analysis,
      last_updated: new Date().toISOString(),
      cache_version: FULL_PRODUCT_CACHE_VERSION,
    },
    { onConflict: 'marketplace,product_id,cache_version' },
  );
}

export async function lookupCheapOffers(
  supabase: SupabaseClient,
  marketplace: Marketplace,
  productId: string,
  sourcePrice: number | null,
): Promise<CheapOffer[]> {
  const bare = stripProductIdPrefix(marketplace, productId);
  const idCandidates = productIdLookupCandidates(marketplace, bare);
  const offers: CheapOffer[] = [];

  for (const target of OTHER_MPS) {
    if (target === marketplace) continue;

    let mapping: {
      target_product_id: string;
      target_url: string;
    } | null = null;

    for (const sourceId of idCandidates) {
      const { data } = await supabase
        .from('cross_market_mapping')
        .select('target_product_id, target_url, rank')
        .eq('source_marketplace', marketplace)
        .eq('source_product_id', sourceId)
        .eq('target_marketplace', target)
        .eq('status', 'active')
        .order('rank', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (data?.target_product_id) {
        mapping = data;
        break;
      }
    }

    if (!mapping) continue;

    const targetId = String(mapping.target_product_id);
    const targetUrl = String(mapping.target_url || '');
    const fetched = await fetchMarketplacePriceDetailed(
      target,
      stripProductIdPrefix(target, targetId),
      targetUrl,
      { supabase },
    );

    const price = fetched?.price && fetched.price > 0 ? fetched.price : null;
    offers.push({
      marketplace: target,
      productId: stripProductIdPrefix(target, targetId),
      url: fetched?.url || targetUrl,
      price,
      title: fetched?.title,
    });
  }

  offers.sort((a, b) => {
    if (a.price == null && b.price == null) return 0;
    if (a.price == null) return 1;
    if (b.price == null) return -1;
    return a.price - b.price;
  });

  if (sourcePrice != null && sourcePrice > 0) {
    return offers.filter((o) => o.price != null && o.price < sourcePrice);
  }
  return offers.filter((o) => o.price != null);
}

async function invokeAiProxy(body: Record<string, unknown>): Promise<{
  ok: boolean;
  status: number;
  body: {
    ok?: boolean;
    error?: string;
    text?: string;
    analysis?: FullProductAnalysisLike;
    model?: string;
    provider?: string;
    pipeline?: string;
  };
}> {
  const url = Deno.env.get('SUPABASE_URL');
  // Edge→Edge: anon key надёжнее service_role (иначе тело иногда «теряется» → messages required)
  const anon = Deno.env.get('SUPABASE_ANON_KEY')?.trim();
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim();
  const key = anon || service;
  if (!url || !key) {
    return { ok: false, status: 0, body: { error: 'server_misconfigured' } };
  }

  const res = await fetch(`${url}/functions/v1/ai-proxy`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const parsed = await res.json().catch(() => ({})) as {
    ok?: boolean;
    error?: string;
    text?: string;
    analysis?: FullProductAnalysisLike;
    model?: string;
    provider?: string;
    pipeline?: string;
  };

  return { ok: res.ok && Boolean(parsed.ok), status: res.status, body: parsed };
}

const FULL_ANALYSIS_SYSTEM_PROMPT = `Ты — эксперт по покупкам на российских маркетплейсах (Wildberries, Ozon, Яндекс.Маркет).

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

function buildFullAnalysisUserPrompt(params: {
  title: string;
  price: number | null;
  marketplace: Marketplace;
  productId: string;
  reviews: string[];
}): string {
  const article = stripProductIdPrefix(params.marketplace, params.productId);
  const lines = [
    `Товар: ${params.title}`,
    `Артикул: ${article}`,
    `Маркетплейс: ${params.marketplace}`,
    params.price ? `Цена: ${params.price} ₽` : null,
    `Отзывов для анализа: ${params.reviews.length}`,
  ].filter(Boolean);

  const reviewsBlock = params.reviews
    .slice(0, 20)
    .map((r, i) => `--- Отзыв ${i + 1} ---\n${String(r).slice(0, 500)}`)
    .join('\n\n');

  return `${lines.join('\n')}\n\nОтзывы покупателей:\n\n${reviewsBlock}`;
}

function parseProxyAnalysisResult(
  body: {
    text?: string;
    analysis?: FullProductAnalysisLike;
    model?: string;
    provider?: string;
    pipeline?: string;
  },
): { analysis: FullProductAnalysisLike | null; error?: string; model?: string } {
  if (body.analysis) {
    return { analysis: body.analysis, model: body.model };
  }
  if (body.text) {
    const parsed = parseAnalysisJson(body.text);
    if (!parsed) return { analysis: null, error: 'bad_ai_json' };
    return {
      analysis: {
        ...parsed,
        analyzedAt: Date.now(),
        source: body.provider ?? 'grok',
        providerLabel: body.model ?? body.pipeline ?? 'cloud',
      },
      model: body.model,
    };
  }
  return { analysis: null, error: 'empty_ai_response' };
}

async function runFullAnalysisViaProxy(params: {
  title: string;
  price: number | null;
  marketplace: Marketplace;
  productId: string;
  reviews: string[];
  deviceId: string;
  /** Premium → Sonar→GPT; Free → один JSON-вызов */
  premium: boolean;
}): Promise<{ analysis: FullProductAnalysisLike | null; error?: string; model?: string }> {
  const deviceId = params.deviceId.slice(0, 64);
  const article = stripProductIdPrefix(params.marketplace, params.productId);
  const productIdPrefixed = toPrefixedProductId(params.marketplace, params.productId);

  try {
    if (params.premium) {
      const premiumBody = {
        fullAnalysis: true,
        mode: 'full_analysis',
        provider: 'openai',
        deviceId,
        payload: {
          productTitle: params.title,
          productPrice: params.price ?? 0,
          marketplace: params.marketplace,
          article,
          productId: productIdPrefixed,
          reviews: params.reviews,
          totalReviewsFound: params.reviews.length,
        },
      };

      let result = await invokeAiProxy(premiumBody);
      // Fallback: если nested invoke «съел» fullAnalysis → messages path
      if (!result.ok && (result.body.error === 'messages required' || result.status === 400)) {
        console.warn('[product-intel] premium fullAnalysis failed, fallback to messages', result.body.error);
        result = await invokeAiProxy({
          provider: 'openai',
          jsonMode: true,
          temperature: 0.2,
          max_tokens: 2000,
          deviceId,
          messages: [
            { role: 'system', content: FULL_ANALYSIS_SYSTEM_PROMPT },
            {
              role: 'user',
              content: buildFullAnalysisUserPrompt(params),
            },
          ],
        });
      }

      if (!result.ok) {
        return {
          analysis: null,
          error: result.body.error ?? `ai_proxy_${result.status}`,
        };
      }
      return parseProxyAnalysisResult(result.body);
    }

    // Free: один вызов без Sonar
    const freeResult = await invokeAiProxy({
      provider: 'grok',
      jsonMode: true,
      temperature: 0.2,
      max_tokens: 2000,
      deviceId,
      messages: [
        { role: 'system', content: FULL_ANALYSIS_SYSTEM_PROMPT },
        { role: 'user', content: buildFullAnalysisUserPrompt(params) },
      ],
    });

    if (!freeResult.ok) {
      return {
        analysis: null,
        error: freeResult.body.error ?? `ai_proxy_${freeResult.status}`,
      };
    }
    return parseProxyAnalysisResult(freeResult.body);
  } catch (e) {
    return {
      analysis: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/** Читаем рейтинг из WB card API (best-effort). */
async function fetchWbRating(nmId: string): Promise<number | null> {
  try {
    const res = await fetch(
      `https://card.wb.ru/cards/v4/detail?appType=1&curr=rub&dest=-1257786&nm=${nmId}`,
      { headers: { Accept: 'application/json' } },
    );
    if (!res.ok) return null;
    const data = await res.json() as {
      data?: { products?: Array<{ reviewRating?: number; nmReviewRating?: number }> };
    };
    const p = data.data?.products?.[0];
    const r = p?.reviewRating ?? p?.nmReviewRating;
    return typeof r === 'number' && r > 0 ? r : null;
  } catch {
    return null;
  }
}

async function fetchServerReviews(params: {
  marketplace: Marketplace;
  productId: string;
  productUrl: string;
  limit?: number;
}): Promise<{ reviews: string[]; totalFound: number }> {
  const scraper = projectScraperCredentials();
  const limit = params.limit ?? 40;
  if (params.marketplace === 'wildberries') {
    return fetchWildberriesReviewsServer(params.productId, limit);
  }
  if (params.marketplace === 'ozon') {
    return fetchOzonReviewsServer(
      params.productId,
      params.productUrl,
      limit,
      scraper,
    );
  }
  return fetchYandexMarketReviewsServer(
    params.productId,
    params.productUrl,
    limit,
    scraper,
  );
}

export async function runProductIntel(params: {
  supabase: SupabaseClient;
  parsed: ParsedProductLink;
  chatId?: string;
  userId?: string | null;
  /** Premium → Sonar full pipeline */
  isPremium?: boolean;
  /** Разрешить cold-start AI */
  allowGenerate?: boolean;
  /** Отзывы уже собраны (extension) — пропуск server fetch */
  reviews?: string[];
}): Promise<ProductIntelCard> {
  const { supabase, parsed } = params;
  const bareId = stripProductIdPrefix(parsed.marketplace, parsed.productId);
  const key = productKey(parsed.marketplace, bareId);
  const allowGenerate = params.allowGenerate !== false;
  const isPremium = Boolean(params.isPremium);
  const scraper = projectScraperCredentials();

  const fetched = await fetchMarketplacePriceDetailed(
    parsed.marketplace,
    bareId,
    parsed.url,
    { supabase, scraper },
  );

  const title = (fetched?.title || parsed.titleHint || 'Товар').slice(0, 500);
  const price = fetched?.price && fetched.price > 0 ? fetched.price : null;
  const url = fetched?.url || parsed.url;

  let rating: number | null =
    fetched?.rating != null && fetched.rating > 0 ? Number(fetched.rating) : null;
  let imageUrl: string | null =
    fetched?.imageUrl?.startsWith('http') ? fetched.imageUrl : null;

  if (parsed.marketplace === 'wildberries') {
    if (rating == null) rating = await fetchWbRating(bareId);
    if (!imageUrl) imageUrl = guessWbImageUrl(bareId);
  }

  const cached = await loadCacheEntry(supabase, parsed.marketplace, bareId);
  let analysis: FullProductAnalysisLike | null = cached?.analysis ?? null;
  let fromCache = Boolean(cached);
  let analysisStatus: ProductIntelCard['analysisStatus'] = analysis ? 'ready' : 'missing';
  let analysisNote: string | undefined;
  let cacheProductId = cached?.cacheProductId ?? toPrefixedProductId(parsed.marketplace, bareId);

  const providedReviews = Array.isArray(params.reviews)
    ? params.reviews.map((r) => String(r).trim()).filter((r) => r.length >= 5)
    : null;

  if (!analysis && allowGenerate) {
    if (!params.userId && !providedReviews) {
      analysisStatus = 'missing';
      analysisNote =
        'Чтобы запустить AI-анализ, привяжите Telegram в расширении (Настройки → «Подключить и проверить»).';
    } else {
      let reviews = providedReviews ?? [];
      if (reviews.length < MIN_REVIEWS) {
        const fetchedReviews = await fetchServerReviews({
          marketplace: parsed.marketplace,
          productId: bareId,
          productUrl: url,
        });
        reviews = fetchedReviews.reviews;
      }

      if (reviews.length < MIN_REVIEWS) {
        analysisStatus = 'insufficient_reviews';
        analysisNote =
          `Недостаточно отзывов для AI (${reviews.length}/${MIN_REVIEWS}). ` +
          (parsed.marketplace === 'wildberries'
            ? 'Откройте товар в расширении или попробуйте позже.'
            : 'Попробуйте позже или сделайте анализ в расширении Chrome.');
      } else {
        const ai = await runFullAnalysisViaProxy({
          title,
          price,
          marketplace: parsed.marketplace,
          productId: bareId,
          reviews,
          deviceId: params.chatId
            ? `tg:${params.chatId}`
            : params.userId
              ? `uid:${params.userId}`
              : `pi:${bareId}`,
          premium: isPremium,
        });
        if (ai.analysis) {
          analysis = {
            ...ai.analysis,
            analyzedAt: ai.analysis.analyzedAt ?? Date.now(),
          };
          analysisStatus = 'ready';
          fromCache = false;
          await putCacheEntry(supabase, {
            marketplace: parsed.marketplace,
            productId: bareId,
            productTitle: title,
            reviews,
            analysis,
            model: ai.model,
          });
          cacheProductId = toPrefixedProductId(parsed.marketplace, bareId);
        } else {
          analysisStatus = 'error';
          analysisNote = ai.error
            ? `AI временно недоступен (${ai.error}).`
            : 'AI временно недоступен.';
        }
      }
    }
  }

  const offers = await lookupCheapOffers(supabase, parsed.marketplace, bareId, price);

  return {
    marketplace: parsed.marketplace,
    productId: bareId,
    productKey: key,
    cacheProductId,
    url,
    title,
    price,
    rating,
    imageUrl,
    analysis,
    fromCache,
    analysisStatus,
    analysisNote,
    offers,
    analyzedAt: analysis?.analyzedAt ?? (cached ? Date.parse(cached.lastUpdated) : null),
  };
}

export async function loadAnalysisForKey(
  supabase: SupabaseClient,
  marketplace: Marketplace,
  productId: string,
): Promise<FullProductAnalysisLike | null> {
  const cached = await loadCacheEntry(supabase, marketplace, productId);
  return cached?.analysis ?? null;
}
