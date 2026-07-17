/**
 * Клиент записи выбора пользователя (обучение матчинга).
 */

import { callEdgeSafe } from '@/lib/supabase/edge';
import { extractComparisonArticle, normalizeCompareUrl } from '@/utils/comparison-url';
import type { ComparisonMarketplace } from '@/types/comparison';

export async function recordMatchFeedback(params: {
  sourceMarketplace: ComparisonMarketplace;
  sourceProductId: string;
  targetMarketplace: ComparisonMarketplace;
  candidateUrl: string;
  accepted?: boolean;
  matchConfidence?: number;
  priority?: number;
}): Promise<void> {
  const {
    sourceMarketplace,
    sourceProductId,
    targetMarketplace,
    candidateUrl,
    accepted = true,
    matchConfidence,
    priority,
  } = params;

  if (!sourceProductId || sourceMarketplace === targetMarketplace) return;
  if (!candidateUrl.startsWith('http')) return;

  const candidateProductId = extractComparisonArticle(candidateUrl, targetMarketplace);
  if (!candidateProductId) return;

  await callEdgeSafe('match-feedback', {
    action: 'record',
    sourceMarketplace,
    sourceProductId,
    targetMarketplace,
    candidateProductId,
    candidateUrl: normalizeCompareUrl(candidateUrl),
    accepted,
    matchConfidence,
    priority,
  });
}
