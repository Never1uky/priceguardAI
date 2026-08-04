/**
 * Политика Free AI quota (3/день) для полного AI-анализа.
 *
 * - `user_run` (кнопка «Запустить AI-анализ»): любой успешный показ результата
 *   пользователю — живой AI ИЛИ cache hit как ответ на этот run → списать 1.
 * - `soft_refresh` (мягкое обновление цены): AI-текст не пересчитывается → НЕ списывать.
 * - `hard_refresh` (жёсткое обновление): полный AI заново → списать при успехе.
 * - `hydrate_cache` (тихий показ кэша при открытии вкладки без Run) → НЕ списывать
 *   (обрабатывается только в UI, сюда не передаётся).
 * - Полный провал (нет валидного analysis) → НЕ списывать.
 */

export type FullAnalysisQuotaIntent = 'user_run' | 'soft_refresh' | 'hard_refresh';

export function deriveFullAnalysisQuotaIntent(flags: {
  softRefresh?: boolean;
  forceRefresh?: boolean;
  forceHardRefresh?: boolean;
}): FullAnalysisQuotaIntent {
  if (flags.forceHardRefresh || flags.forceRefresh) return 'hard_refresh';
  if (flags.softRefresh) return 'soft_refresh';
  return 'user_run';
}

/** Нужно ли списать 1 Free-попытку после успешного ответа SW. */
export function shouldConsumeFullAnalysisQuota(params: {
  intent: FullAnalysisQuotaIntent;
  ok: boolean;
  hasAnalysis: boolean;
}): boolean {
  if (!params.ok || !params.hasAnalysis) return false;
  if (params.intent === 'soft_refresh') return false;
  return params.intent === 'user_run' || params.intent === 'hard_refresh';
}

export function fullAnalysisCacheBadgeLabel(params: {
  fromCache: boolean;
  /** Попытка списана за этот user_run / hard (не auto-hydrate) */
  quotaConsumed?: boolean;
  cacheReason?: string | null;
}): string | null {
  if (!params.fromCache) return null;

  const reasonLabel = ((): string | null => {
    switch (params.cacheReason) {
      case 'SOFT_REFRESH':
        return 'Цена обновлена';
      case 'SAME_SKU':
        return 'Тот же SKU';
      case 'CROSS_MARKETPLACE':
        return 'Другая площадка';
      case 'REVIEWS_MATCH':
        return 'Те же отзывы';
      case 'REMOTE_CACHE':
        return 'Общий кэш';
      case 'LOCAL_CACHE':
        return 'Локальный кэш';
      default:
        return null;
    }
  })();

  if (params.quotaConsumed) {
    return reasonLabel ? `Из кэша · ${reasonLabel} · попытка учтена` : 'Из кэша · попытка учтена';
  }
  return reasonLabel ? `Из кэша · ${reasonLabel}` : 'Из кэша';
}
