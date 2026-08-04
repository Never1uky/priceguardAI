/**
 * Promote crowd-consensus edges from match_feedback → cross_market_mapping (evidence: multi_user).
 */

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const VALID = ['wildberries', 'ozon', 'yandex_market'] as const;
type Marketplace = (typeof VALID)[number];

export const MULTI_USER_MIN_ACCEPTS = 2;
export const MULTI_USER_MIN_ACCEPT_DAYS = 2;
export const MULTI_USER_MIN_DISTINCT_USERS = 2;
export const MULTI_USER_MIN_AVG_CONFIDENCE = 70;
export const MULTI_USER_MIN_TITLE_SCORE = 70;
export const DISPUTE_COOLDOWN_DAYS = 7;

export interface MultiUserPromoteParams {
  sourceMarketplace: Marketplace;
  sourceProductId: string;
  targetMarketplace: Marketplace;
  candidateProductId: string;
  candidateUrl: string;
  matchConfidence?: number | null;
  sourceTitle?: string | null;
  candidateTitle?: string | null;
}

interface FeedbackRow {
  accepted: boolean;
  created_at: string;
  user_id?: string | null;
  match_confidence?: number | null;
  source_title?: string | null;
  candidate_title?: string | null;
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

const EVIDENCE_RANK: Record<string, number> = {
  auto: 0,
  multi_user: 1,
  manual: 2,
};

function shouldKeepExistingEvidence(existing: string | null | undefined, incoming: string): boolean {
  const cur = EVIDENCE_RANK[existing ?? 'auto'] ?? 0;
  const next = EVIDENCE_RANK[incoming] ?? 0;
  return cur > next;
}

async function auditPromote(
  supabase: SupabaseClient,
  params: MultiUserPromoteParams,
  promoted: boolean,
  reason: string,
  details?: Record<string, unknown>,
): Promise<void> {
  try {
    await supabase.from('mapping_promotion_audit').insert({
      source_marketplace: params.sourceMarketplace,
      source_product_id: params.sourceProductId,
      target_marketplace: params.targetMarketplace,
      target_product_id: params.candidateProductId,
      promoted,
      reason,
      details: details ?? null,
    });
  } catch (e) {
    console.warn('[multi-user] audit failed', e);
  }
}

/** After accepted feedback, maybe upsert global mapping for all users. */
export async function maybePromoteMultiUserMapping(
  supabase: SupabaseClient,
  params: MultiUserPromoteParams,
): Promise<{ promoted: boolean; accepts?: number; acceptDays?: number; reason?: string }> {
  const {
    sourceMarketplace,
    sourceProductId,
    targetMarketplace,
    candidateProductId,
    candidateUrl,
    matchConfidence,
    sourceTitle,
    candidateTitle,
  } = params;

  if (!VALID.includes(sourceMarketplace) || !VALID.includes(targetMarketplace)) {
    return { promoted: false, reason: 'invalid_marketplace' };
  }
  if (sourceMarketplace === targetMarketplace) {
    return { promoted: false, reason: 'same_marketplace' };
  }
  if (!sourceProductId || !candidateProductId || !candidateUrl) {
    return { promoted: false, reason: 'missing_ids' };
  }

  const { data: feedback, error: readErr } = await supabase
    .from('match_feedback')
    .select('accepted, created_at, user_id, match_confidence, source_title, candidate_title')
    .eq('source_marketplace', sourceMarketplace)
    .eq('source_product_id', sourceProductId)
    .eq('target_marketplace', targetMarketplace)
    .eq('candidate_product_id', candidateProductId);

  if (readErr) {
    console.error('multi_user promote feedback read', readErr);
    return { promoted: false, reason: 'feedback_read_error' };
  }

  const rows = (feedback ?? []) as FeedbackRow[];
  const stats = aggregateMatchFeedback(rows);

  let titleScore: number | null = null;
  if (sourceTitle?.trim() && candidateTitle?.trim()) {
    titleScore = scoreTitleSimilarity(sourceTitle, candidateTitle);
  } else {
    for (const r of rows) {
      if (r.accepted && r.source_title?.trim() && r.candidate_title?.trim()) {
        titleScore = scoreTitleSimilarity(r.source_title, r.candidate_title);
        break;
      }
    }
  }

  const gate = shouldPromoteMultiUserMapping({ ...stats, titleScore });
  if (!gate.ok) {
    await auditPromote(supabase, params, false, gate.reason, { ...stats, titleScore });
    return {
      promoted: false,
      accepts: stats.accepts,
      acceptDays: stats.acceptDays,
      reason: gate.reason,
    };
  }

  const { data: existing, error: mapReadErr } = await supabase
    .from('cross_market_mapping')
    .select('evidence, status, hits, fail_count, confidence, updated_at')
    .eq('source_marketplace', sourceMarketplace)
    .eq('source_product_id', sourceProductId)
    .eq('target_marketplace', targetMarketplace)
    .eq('target_product_id', candidateProductId)
    .maybeSingle();

  if (mapReadErr) {
    console.error('multi_user promote mapping read', mapReadErr);
    return { promoted: false, reason: 'mapping_read_error' };
  }

  if (existing?.status === 'dead') {
    await auditPromote(supabase, params, false, 'status_dead', { status: existing.status });
    return { promoted: false, accepts: stats.accepts, acceptDays: stats.acceptDays, reason: 'status_dead' };
  }

  if (existing?.status === 'disputed') {
    const updatedAt = Date.parse(String(existing.updated_at ?? ''));
    const coolMs = DISPUTE_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
    if (!Number.isFinite(updatedAt) || Date.now() - updatedAt < coolMs) {
      await auditPromote(supabase, params, false, 'dispute_cooldown', {
        updated_at: existing.updated_at,
      });
      return {
        promoted: false,
        accepts: stats.accepts,
        acceptDays: stats.acceptDays,
        reason: 'dispute_cooldown',
      };
    }
  }

  if (shouldKeepExistingEvidence(existing?.evidence, 'multi_user')) {
    await auditPromote(supabase, params, false, 'evidence_outranked', {
      evidence: existing?.evidence,
    });
    return {
      promoted: false,
      accepts: stats.accepts,
      acceptDays: stats.acceptDays,
      reason: 'evidence_outranked',
    };
  }

  const now = new Date().toISOString();
  const confidence = multiUserMappingConfidence(
    stats.accepts,
    matchConfidence ?? stats.avgConfidence,
  );

  const { error: upsertErr } = await supabase.from('cross_market_mapping').upsert(
    {
      source_marketplace: sourceMarketplace,
      source_product_id: sourceProductId,
      target_marketplace: targetMarketplace,
      target_product_id: candidateProductId,
      target_url: candidateUrl.slice(0, 500),
      confidence,
      hits: (existing?.hits ?? 0) + 1,
      rank: 0,
      status: 'active',
      evidence: 'multi_user',
      fail_count: existing?.fail_count ?? 0,
      last_verified_at: now,
      updated_at: now,
    },
    {
      onConflict: 'source_marketplace,source_product_id,target_marketplace,target_product_id',
    },
  );

  if (upsertErr) {
    console.error('multi_user promote upsert', upsertErr);
    await auditPromote(supabase, params, false, 'upsert_error');
    return { promoted: false, reason: 'upsert_error' };
  }

  await auditPromote(supabase, params, true, 'promoted', {
    ...stats,
    titleScore,
    confidence,
  });
  return { promoted: true, accepts: stats.accepts, acceptDays: stats.acceptDays, reason: 'promoted' };
}
