/**
 * Локальная оценка полезности AI-анализа (без отправки на сервер).
 */

const STORAGE_KEY = 'priceguard_analysis_feedback';

export type AnalysisFeedbackVote = 'up' | 'down';

type FeedbackMap = Record<string, AnalysisFeedbackVote>;

function feedbackKey(productId: string, analyzedAt: number): string {
  return `${productId}:${analyzedAt}`;
}

export async function getAnalysisFeedback(
  productId: string,
  analyzedAt: number,
): Promise<AnalysisFeedbackVote | null> {
  const raw = await chrome.storage.local.get(STORAGE_KEY);
  const map = (raw[STORAGE_KEY] as FeedbackMap | undefined) ?? {};
  return map[feedbackKey(productId, analyzedAt)] ?? null;
}

export async function setAnalysisFeedback(
  productId: string,
  analyzedAt: number,
  vote: AnalysisFeedbackVote,
): Promise<void> {
  const raw = await chrome.storage.local.get(STORAGE_KEY);
  const map = { ...((raw[STORAGE_KEY] as FeedbackMap | undefined) ?? {}) };
  map[feedbackKey(productId, analyzedAt)] = vote;
  await chrome.storage.local.set({ [STORAGE_KEY]: map });
}

/** Считает распределение оценок 1–5; null если меньше minCount валидных. */
export function buildStarDistribution(
  ratings: Array<number | undefined> | undefined,
  minCount = 5,
): number[] | null {
  if (!ratings?.length) return null;
  const counts = [0, 0, 0, 0, 0];
  let n = 0;
  for (const r of ratings) {
    if (typeof r !== 'number' || !Number.isFinite(r)) continue;
    const star = Math.round(r);
    if (star < 1 || star > 5) continue;
    counts[star - 1]! += 1;
    n += 1;
  }
  return n >= minCount ? counts : null;
}
