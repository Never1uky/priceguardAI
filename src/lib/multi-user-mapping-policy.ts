/** Pure policy helpers for multi_user promotion (mirrors supabase/functions/_shared/multi-user-mapping.ts). */

export const MULTI_USER_MIN_ACCEPTS = 2;
export const MULTI_USER_MIN_ACCEPT_DAYS = 2;
export const MULTI_USER_MIN_DISTINCT_USERS = 2;
export const MULTI_USER_MIN_AVG_CONFIDENCE = 70;
export const MULTI_USER_MIN_TITLE_SCORE = 70;
export const DISPUTE_COOLDOWN_DAYS = 7;

interface FeedbackRow {
  accepted: boolean;
  created_at: string;
  user_id?: string | null;
  match_confidence?: number | null;
  fingerprint?: string | null;
}

export function scoreTitleSimilarity(ref: string, cand: string): number {
  const a = ref.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
  const b = new Set(cand.toLowerCase().split(/\s+/).filter((t) => t.length > 2));
  if (!a.length) return 50;
  let hit = 0;
  for (const t of a) if (b.has(t)) hit += 1;
  return Math.round((hit / a.length) * 100);
}

export function aggregateMatchFeedback(rows: FeedbackRow[]): {
  accepts: number;
  rejects: number;
  acceptDays: number;
  distinctUsers: number;
  avgConfidence: number | null;
  recentRejects: number;
} {
  let accepts = 0;
  let rejects = 0;
  let recentRejects = 0;
  const acceptDaySet = new Set<string>();
  const userSet = new Set<string>();
  const confidences: number[] = [];
  const rejectSince = Date.now() - DISPUTE_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;

  for (const row of rows) {
    if (row.accepted) {
      accepts += 1;
      acceptDaySet.add(String(row.created_at).slice(0, 10));
      if (row.user_id) userSet.add(row.user_id);
      if (row.match_confidence != null && row.match_confidence > 0) {
        confidences.push(Number(row.match_confidence));
      }
    } else {
      rejects += 1;
      const ts = Date.parse(String(row.created_at));
      if (Number.isFinite(ts) && ts >= rejectSince) recentRejects += 1;
    }
  }

  const avgConfidence = confidences.length
    ? Math.round(confidences.reduce((a, b) => a + b, 0) / confidences.length)
    : null;

  return {
    accepts,
    rejects,
    acceptDays: acceptDaySet.size,
    distinctUsers: userSet.size,
    avgConfidence,
    recentRejects,
  };
}

export function shouldPromoteMultiUserMapping(stats: {
  accepts: number;
  rejects: number;
  acceptDays: number;
  distinctUsers: number;
  avgConfidence: number | null;
  recentRejects: number;
  titleScore?: number | null;
}): { ok: boolean; reason: string } {
  if (stats.accepts < MULTI_USER_MIN_ACCEPTS) {
    return { ok: false, reason: 'insufficient_accepts' };
  }
  if (stats.acceptDays < MULTI_USER_MIN_ACCEPT_DAYS) {
    return { ok: false, reason: 'insufficient_accept_days' };
  }
  if (stats.distinctUsers > 0 && stats.distinctUsers < MULTI_USER_MIN_DISTINCT_USERS) {
    return { ok: false, reason: 'insufficient_distinct_users' };
  }
  if (stats.rejects > 0 && stats.rejects >= stats.accepts * 0.5) {
    return { ok: false, reason: 'reject_ratio' };
  }
  if (stats.rejects >= stats.accepts) {
    return { ok: false, reason: 'rejects_gte_accepts' };
  }
  if (stats.recentRejects > 0) {
    return { ok: false, reason: 'recent_reject_cooldown' };
  }
  if (
    stats.avgConfidence != null &&
    stats.avgConfidence < MULTI_USER_MIN_AVG_CONFIDENCE
  ) {
    return { ok: false, reason: 'avg_confidence_low' };
  }
  if (
    stats.titleScore != null &&
    stats.titleScore < MULTI_USER_MIN_TITLE_SCORE
  ) {
    return { ok: false, reason: 'title_similarity_low' };
  }
  return { ok: true, reason: 'ok' };
}

export function multiUserMappingConfidence(accepts: number, matchConfidence?: number | null): number {
  const fromVotes = Math.min(95, 70 + accepts * 5);
  if (matchConfidence != null && matchConfidence > 0) {
    return Math.min(95, Math.max(fromVotes, Math.round(matchConfidence)));
  }
  return fromVotes;
}

export interface FingerprintFeedbackBias {
  fingerprint: string;
  accepts: number;
  rejects: number;
  rejectsRecent: number;
}

/**
 * Aggregate accept/reject weak labels per deterministic fingerprint.
 * Missing fingerprint rows are ignored to prevent noisy overfitting.
 */
export function aggregateFeedbackBiasByFingerprint(
  rows: FeedbackRow[],
  nowMs = Date.now(),
): FingerprintFeedbackBias[] {
  const rejectSince = nowMs - DISPUTE_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
  const map = new Map<string, FingerprintFeedbackBias>();
  for (const row of rows) {
    const fp = row.fingerprint?.trim().toLowerCase();
    if (!fp) continue;
    const current = map.get(fp) ?? {
      fingerprint: fp,
      accepts: 0,
      rejects: 0,
      rejectsRecent: 0,
    };
    if (row.accepted) {
      current.accepts += 1;
    } else {
      current.rejects += 1;
      const ts = Date.parse(String(row.created_at));
      if (Number.isFinite(ts) && ts >= rejectSince) current.rejectsRecent += 1;
    }
    map.set(fp, current);
  }
  return [...map.values()];
}
