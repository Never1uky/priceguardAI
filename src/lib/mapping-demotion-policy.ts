/** Pure policy for cross_market_mapping demotion (mirrors edge dispute behavior). */

export const DISPUTE_CONFIDENCE_PENALTY = 35;
export const DISPUTE_HITS_PENALTY = 2;

export function demoteMappingOnDispute(existing: {
  confidence?: number | null;
  hits?: number | null;
}): { confidence: number; hits: number } {
  const confidence = Math.max(0, (existing.confidence ?? 0) - DISPUTE_CONFIDENCE_PENALTY);
  const hits = Math.max(0, (existing.hits ?? 0) - DISPUTE_HITS_PENALTY);
  return { confidence, hits };
}

/** Auto upsert must not revive disputed/dead edges. */
export function shouldSkipAutoUpsert(existingStatus: string | null | undefined): boolean {
  return existingStatus === 'disputed' || existingStatus === 'dead';
}

/** Recent reject feedback blocks auto remember/upsert. */
export const REJECT_FEEDBACK_BLOCK_DAYS = 30;

export function hasBlockingRejectFeedback(
  rejectsRecent: number,
  options?: { disputedOrDead?: boolean },
): boolean {
  if (options?.disputedOrDead) return true;
  return rejectsRecent > 0;
}
