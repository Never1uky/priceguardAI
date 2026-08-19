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
export const FEEDBACK_POSITIVE_BIAS_CAP = 0.06;
export const FEEDBACK_NEGATIVE_BIAS_CAP = 0.08;

export interface FeedbackBiasStats {
  accepts: number;
  rejects: number;
  rejectsRecent?: number;
}

export function computeFeedbackScoreBias(
  stats: FeedbackBiasStats,
): { delta: number; blocked: boolean; reason: string } {
  const accepts = Math.max(0, stats.accepts || 0);
  const rejects = Math.max(0, stats.rejects || 0);
  const recent = Math.max(0, stats.rejectsRecent || 0);

  if (recent > 0) {
    return { delta: -FEEDBACK_NEGATIVE_BIAS_CAP, blocked: true, reason: 'recent_reject' };
  }
  if (rejects > accepts) {
    return { delta: -FEEDBACK_NEGATIVE_BIAS_CAP, blocked: true, reason: 'reject_dominates' };
  }
  if (rejects > 0) {
    const penalty = Math.min(
      FEEDBACK_NEGATIVE_BIAS_CAP,
      rejects * 0.02 + Math.max(0, rejects - accepts) * 0.02,
    );
    return { delta: -penalty, blocked: false, reason: 'reject_penalty' };
  }
  if (accepts > 0) {
    const boost = Math.min(FEEDBACK_POSITIVE_BIAS_CAP, accepts * 0.015);
    return { delta: boost, blocked: false, reason: 'accept_boost' };
  }
  return { delta: 0, blocked: false, reason: 'no_feedback' };
}

export function hasBlockingRejectFeedback(
  rejectsRecent: number,
  options?: { disputedOrDead?: boolean },
): boolean {
  if (options?.disputedOrDead) return true;
  return rejectsRecent > 0;
}
