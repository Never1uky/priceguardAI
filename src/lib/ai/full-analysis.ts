import { ApiError } from '@/api/errors';
import { analyzeFullViaCloud, canUseCloudFullAnalysis } from '@/lib/ai/full-analysis-cloud';
import {
  FULL_ANALYSIS_SYSTEM_PROMPT,
  buildFullAnalysisUserPrompt,
} from '@/lib/ai/prompts';
import { AI_REQUEST_DEFAULTS } from '@/lib/ai/schemas';
import { isPremium } from '@/lib/subscription';
import type { FullAnalysisInput, FullProductAnalysis } from '@/types/full-analysis';

export type FullAnalysisSource = 'cloud' | 'local' | 'cache' | 'stale_cache';

export interface FullAnalysisRunResult {
  analysis: FullProductAnalysis;
  source: FullAnalysisSource;
  /** Пояснение для UI при fallback */
  cacheNote?: string;
}

export interface FullAnalysisRunOptions {
  /** Уже проверенный кэш (local) — не вызывать AI */
  cachedResult?: FullProductAnalysis | null;
  /** Последний кэш для fallback при сбое API */
  staleCachedResult?: FullProductAnalysis | null;
  staleCacheSavedAt?: number;
  /** Принудительно Premium pipeline (иначе определяется через isPremium) */
  forceFullPipeline?: boolean;
}

function withStaleNote(
  analysis: FullProductAnalysis,
  savedAt?: number,
): FullAnalysisRunResult {
  const date = savedAt ? new Date(savedAt).toLocaleString('ru-RU') : '';
  return {
    analysis: {
      ...analysis,
      providerLabel:
        analysis.source === 'local'
          ? `${analysis.providerLabel} (кэш)`
          : `${analysis.providerLabel} · кэш`,
    },
    source: 'stale_cache',
    cacheNote: date
      ? `AI временно недоступен. Показан сохранённый анализ от ${date}.`
      : 'AI временно недоступен. Показан последний сохранённый анализ.',
  };
}

/**
 * Полный анализ:
 * Free → один вызов Grok/GPT-mini
 * Premium → Sonar → GPT (fullAnalysis: true)
 * Fallback: stale cache → локальная эвристика
 */
export async function runFullProductAnalysis(
  input: FullAnalysisInput,
  options: FullAnalysisRunOptions = {},
): Promise<FullAnalysisRunResult> {
  if (options.cachedResult) {
    return { analysis: options.cachedResult, source: 'cache' };
  }

  if (input.reviews.length < 5) {
    throw new ApiError({
      code: 'bad_request',
      retryable: false,
      userMessage: `Недостаточно отзывов (${input.reviews.length}). Нужно минимум 5.`,
    });
  }

  const premium = options.forceFullPipeline ?? (await isPremium());

  if (canUseCloudFullAnalysis()) {
    try {
      const analysis = await analyzeFullViaCloud(input, {
        fullAnalysis: premium,
      });
      return { analysis, source: 'cloud' };
    } catch (error) {
      console.warn('[PriceGuard] Cloud full analysis failed:', error);

      if (options.staleCachedResult) {
        return withStaleNote(options.staleCachedResult, options.staleCacheSavedAt);
      }

      const message =
        error instanceof ApiError
          ? error.userMessage
          : 'Облачный AI недоступен. Используем локальную оценку.';

      const local = await import('@/lib/ai/full-analysis-local').then((m) =>
        m.analyzeFullLocally(input),
      );
      return {
        analysis: local,
        source: 'local',
        cacheNote: message,
      };
    }
  }

  if (options.staleCachedResult) {
    return withStaleNote(options.staleCachedResult, options.staleCacheSavedAt);
  }

  const { analyzeFullLocally } = await import('@/lib/ai/full-analysis-local');
  return {
    analysis: analyzeFullLocally(input),
    source: 'local',
    cacheNote: 'AI-сервер не настроен. Показана локальная оценка.',
  };
}

/** Пример user-промпта для документации / отладки */
export function buildFullAnalysisPromptPreview(input: FullAnalysisInput): {
  system: string;
  user: string;
  options: typeof AI_REQUEST_DEFAULTS;
} {
  return {
    system: FULL_ANALYSIS_SYSTEM_PROMPT,
    user: buildFullAnalysisUserPrompt(input),
    options: { ...AI_REQUEST_DEFAULTS, maxTokens: 1_000 } as typeof AI_REQUEST_DEFAULTS & {
      maxTokens: number;
    },
  };
}
