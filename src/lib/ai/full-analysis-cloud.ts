import {
  getProviderLabel,
  isCloudAiAvailable,
  parseAiJson,
  sendFullAnalysisViaProxy,
  sendToAIWithFallback,
  type AiProviderName,
  type FullAnalysisProxyPayload,
} from '@/api/ai';
import { ApiError } from '@/api/errors';
import { normalizeFullAnalysisResponse } from '@/lib/ai/full-analysis-local';
import {
  FULL_ANALYSIS_SYSTEM_PROMPT,
  buildFullAnalysisUserPrompt,
} from '@/lib/ai/prompts';
import { AI_REQUEST_DEFAULTS, validateFullAnalysisJson } from '@/lib/ai/schemas';
import { getCachedWebResearch, saveCachedWebResearch } from '@/lib/web-research-cache';
import {
  getRemoteWebResearchCache,
  putRemoteWebResearchCache,
} from '@/lib/supabase/product-cache';
import type { Marketplace } from '@/types/product';
import type { FullAnalysisInput, FullProductAnalysis } from '@/types/full-analysis';
import { FULL_ANALYSIS_SCHEMA_VERSION } from '@/types/full-analysis';
import type { AiProvider } from '@/types/review-analysis';

export interface AnalyzeFullCloudOptions {
  /**
   * true = Sonar → GPT (deep / «Глубокий разбор»).
   * false/omit = lite: один вызов Grok/GPT-mini без Perplexity.
   */
  webResearch?: boolean;
  /** @deprecated use webResearch */
  fullAnalysis?: boolean;
}

function toResult(
  text: string,
  providerUsed: AiProviderName,
  labelOverride?: string,
  webSources?: FullProductAnalysis['webSources'],
): FullProductAnalysis {
  const raw = parseAiJson<unknown>(text, getProviderLabel(providerUsed));
  const validated = validateFullAnalysisJson(raw);
  const normalized = normalizeFullAnalysisResponse(validated);

  return {
    ...normalized,
    webSources: webSources?.length ? webSources : normalized.webSources,
    source: providerUsed as AiProvider,
    providerLabel: labelOverride ?? getProviderLabel(providerUsed),
    analyzedAt: Date.now(),
    schemaVersion: FULL_ANALYSIS_SCHEMA_VERSION,
  };
}

async function buildProxyPayload(input: FullAnalysisInput): Promise<FullAnalysisProxyPayload> {
  const base: FullAnalysisProxyPayload = {
    productTitle: input.productTitle,
    productPrice: input.productPrice,
    oldPrice: input.oldPrice,
    marketplace: input.marketplace,
    article: input.article,
    productId: input.productId,
    forceRefreshWeb: input.forceRefreshWeb,
    reviews: input.reviews,
    totalReviewsFound: input.totalReviewsFound,
    priceHistory: input.priceHistory,
    compareOffers: input.compareOffers,
  };

  if (!input.productId || input.forceRefreshWeb) return base;

  const mp = input.marketplace as Marketplace;
  const local = await getCachedWebResearch(mp, input.productId);
  if (local?.fresh) {
    return {
      ...base,
      cachedWebResearch: { text: local.text, sources: local.sources },
    };
  }

  const remote = await getRemoteWebResearchCache(mp, input.productId);
  if (remote?.fresh) {
    await saveCachedWebResearch(mp, input.productId, {
      text: remote.text,
      sources: remote.sources,
    });
    return {
      ...base,
      cachedWebResearch: { text: remote.text, sources: remote.sources },
    };
  }

  return base;
}

async function persistWebResearchCache(
  input: FullAnalysisInput,
  text: string | undefined,
  sources: FullProductAnalysis['webSources'],
  cached: boolean,
): Promise<void> {
  if (!input.productId || !text?.trim()) return;

  const mp = input.marketplace as Marketplace;
  await saveCachedWebResearch(mp, input.productId, { text, sources });

  if (!cached) {
    await putRemoteWebResearchCache({
      marketplace: mp,
      productId: input.productId,
      productTitle: input.productTitle,
      text,
      sources,
    });
  }
}

/**
 * Облачный полный анализ.
 * - lite (default): один запрос Grok/GPT-4o mini (только отзывы)
 * - webResearch: ai-proxy pipeline Sonar → GPT (кэш v3 / daily Sonar cap)
 */
export async function analyzeFullViaCloud(
  input: FullAnalysisInput,
  options: AnalyzeFullCloudOptions = {},
): Promise<FullProductAnalysis> {
  const useSonar =
    options.webResearch === true || options.fullAnalysis === true;

  if (useSonar) {
    const payload = await buildProxyPayload(input);
    const result = await sendFullAnalysisViaProxy(payload, { webResearch: true });
    const label = result.webResearchUsed
      ? result.webResearchCached
        ? `${getProviderLabel(result.providerUsed)} + веб (кэш)`
        : `${getProviderLabel(result.providerUsed)} + веб`
      : getProviderLabel(result.providerUsed);

    if (result.webResearchUsed && result.webResearchText) {
      await persistWebResearchCache(
        input,
        result.webResearchText,
        result.webSources,
        Boolean(result.webResearchCached),
      );
    }

    try {
      return toResult(result.text, result.providerUsed, label, result.webSources);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError({
        code: 'parse_error',
        provider: label,
        retryable: true,
        userMessage: 'AI вернул некорректный JSON. Повторите анализ.',
        debugMessage: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Lite: дешёвый одиночный вызов без Sonar
  const userPrompt = buildFullAnalysisUserPrompt(input);
  const { text, providerUsed } = await sendToAIWithFallback(
    FULL_ANALYSIS_SYSTEM_PROMPT,
    userPrompt,
    { ...AI_REQUEST_DEFAULTS, maxTokens: 1_000 },
  );

  try {
    return toResult(text, providerUsed);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError({
      code: 'parse_error',
      provider: getProviderLabel(providerUsed),
      retryable: true,
      userMessage: 'AI вернул некорректный JSON. Повторите анализ.',
      debugMessage: error instanceof Error ? error.message : String(error),
    });
  }
}

export function canUseCloudFullAnalysis(): boolean {
  return isCloudAiAvailable();
}
