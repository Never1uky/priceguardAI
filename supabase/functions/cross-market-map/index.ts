// Cross-market mapping v2: primary + alternates, status, dispute, reportFail.
//
// Actions:
//   lookup   → { ok, mappings: row[] }  (active, ordered by rank)
//   upsert   → write primary (+ optional alternates)
//   dispute  → mark edge disputed + demote confidence/hits
//   reportFail → increment fail_count; dead at >= 3

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { corsHeaders, jsonResponse } from '../_shared/utils.ts';
import { requireAuthUser } from '../_shared/auth.ts';

const VALID = ['wildberries', 'ozon', 'yandex_market'];
const MAX_ALTERNATES = 2;
const DISPUTE_CONFIDENCE_PENALTY = 35;
const DISPUTE_HITS_PENALTY = 2;
const REJECT_FEEDBACK_BLOCK_DAYS = 30;

function serviceClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
}

function demoteOnDispute(existing: { confidence?: number | null; hits?: number | null }) {
  return {
    confidence: Math.max(0, (existing.confidence ?? 0) - DISPUTE_CONFIDENCE_PENALTY),
    hits: Math.max(0, (existing.hits ?? 0) - DISPUTE_HITS_PENALTY),
  };
}

async function hasRecentRejectFeedback(
  supabase: ReturnType<typeof serviceClient>,
  params: {
    sourceMarketplace: string;
    sourceProductId: string;
    targetMarketplace: string;
    targetProductId: string;
  },
): Promise<boolean> {
  const since = new Date();
  since.setDate(since.getDate() - REJECT_FEEDBACK_BLOCK_DAYS);
  const { data, error } = await supabase
    .from('match_feedback')
    .select('id')
    .eq('source_marketplace', params.sourceMarketplace)
    .eq('source_product_id', params.sourceProductId)
    .eq('target_marketplace', params.targetMarketplace)
    .eq('candidate_product_id', params.targetProductId)
    .eq('accepted', false)
    .gte('created_at', since.toISOString())
    .limit(1);
  if (error) {
    console.warn('match_feedback reject check', error);
    return false;
  }
  return Boolean(data?.length);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Method not allowed' }, 405);
  }

  try {
    const body = await req.json();
    const action = String(body.action ?? '');
    const sourceMarketplace = String(body.sourceMarketplace ?? '');
    const sourceProductId = String(body.sourceProductId ?? '').slice(0, 64);
    const targetMarketplace = String(body.targetMarketplace ?? '');

    if (!VALID.includes(sourceMarketplace) || !VALID.includes(targetMarketplace)) {
      return jsonResponse({ ok: false, error: 'Invalid marketplace' }, 400);
    }
    if (sourceMarketplace === targetMarketplace) {
      return jsonResponse({ ok: false, error: 'Same marketplace' }, 400);
    }
    if (!sourceProductId) {
      return jsonResponse({ ok: false, error: 'sourceProductId required' }, 400);
    }

    // Mutations require JWT; lookup stays public (shared product IDs only).
    let authUserId: string | null = null;
    if (action !== 'lookup') {
      const user = await requireAuthUser(req, true);
      authUserId = user!.id;
    }

    const supabase = serviceClient();
    const selectCols =
      'source_marketplace, source_product_id, target_marketplace, target_product_id, target_url, confidence, hits, rank, status, evidence, fail_count, last_verified_at';

    if (action === 'lookup') {
      const { data: activeRows, error } = await supabase
        .from('cross_market_mapping')
        .select(selectCols)
        .eq('source_marketplace', sourceMarketplace)
        .eq('source_product_id', sourceProductId)
        .eq('target_marketplace', targetMarketplace)
        .eq('status', 'active')
        .order('rank', { ascending: true })
        .limit(1 + MAX_ALTERNATES);

      if (error) {
        console.error('cross_market_mapping lookup', error);
        return jsonResponse({ ok: false, error: 'Read failed' }, 500);
      }

      const { data: unverifiedRows } = await supabase
        .from('cross_market_mapping')
        .select(selectCols)
        .eq('source_marketplace', sourceMarketplace)
        .eq('source_product_id', sourceProductId)
        .eq('target_marketplace', targetMarketplace)
        .eq('status', 'unverified')
        .order('rank', { ascending: true })
        .limit(MAX_ALTERNATES);

      const rows = activeRows ?? [];
      if (rows[0]) {
        void supabase
          .from('cross_market_mapping')
          .update({
            hits: (rows[0].hits ?? 0) + 1,
            updated_at: new Date().toISOString(),
          })
          .eq('source_marketplace', sourceMarketplace)
          .eq('source_product_id', sourceProductId)
          .eq('target_marketplace', targetMarketplace)
          .eq('target_product_id', rows[0].target_product_id);
      }

      const alternatesUnverified = (unverifiedRows ?? []).map((r) => ({
        ...r,
        unverified: true,
      }));

      return jsonResponse({
        ok: true,
        mapping: rows[0] ?? null,
        mappings: rows,
        unverifiedAlternates: alternatesUnverified,
      });
    }

    if (action === 'upsert') {
      const targetProductId = String(body.targetProductId ?? '').slice(0, 64);
      const targetUrl = String(body.targetUrl ?? '').slice(0, 500);
      const confidence =
        body.confidence != null ? Math.round(Number(body.confidence)) : null;
      const evidence = ['auto', 'manual', 'multi_user'].includes(String(body.evidence))
        ? String(body.evidence)
        : 'auto';
      const rank = Math.max(0, Math.min(MAX_ALTERNATES, Number(body.rank ?? 0) || 0));

      if (!targetProductId || !targetUrl) {
        return jsonResponse({ ok: false, error: 'targetProductId and targetUrl required' }, 400);
      }

      const now = new Date().toISOString();

      const { data: existing } = await supabase
        .from('cross_market_mapping')
        .select('hits, fail_count, evidence, status, confidence')
        .eq('source_marketplace', sourceMarketplace)
        .eq('source_product_id', sourceProductId)
        .eq('target_marketplace', targetMarketplace)
        .eq('target_product_id', targetProductId)
        .maybeSingle();

      if (evidence === 'auto') {
        if (existing?.status === 'disputed' || existing?.status === 'dead') {
          return jsonResponse({ ok: true, skipped: 'disputed_or_dead' });
        }
        if (
          await hasRecentRejectFeedback(supabase, {
            sourceMarketplace,
            sourceProductId,
            targetMarketplace,
            targetProductId,
          })
        ) {
          return jsonResponse({ ok: true, skipped: 'reject_feedback' });
        }
      }

      if (
        (existing?.status === 'disputed' || existing?.status === 'dead') &&
        evidence !== 'manual'
      ) {
        return jsonResponse({ ok: true, skipped: 'disputed_or_dead' });
      }

      if (rank === 0) {
        await supabase
          .from('cross_market_mapping')
          .update({ rank: 1, updated_at: now })
          .eq('source_marketplace', sourceMarketplace)
          .eq('source_product_id', sourceProductId)
          .eq('target_marketplace', targetMarketplace)
          .eq('status', 'active')
          .neq('target_product_id', targetProductId)
          .eq('rank', 0);
      }

      const evidenceRank: Record<string, number> = { auto: 0, multi_user: 1, manual: 2 };
      const existingRank = evidenceRank[existing?.evidence ?? 'auto'] ?? 0;
      const incomingRank = evidenceRank[evidence] ?? 0;
      const resolvedEvidence =
        existing?.evidence && existingRank > incomingRank ? existing.evidence : evidence;

      const matchConfidence =
        body.matchConfidence != null
          ? Math.round(Number(body.matchConfidence))
          : confidence;
      const lowConfidenceManual =
        evidence === 'manual' &&
        matchConfidence != null &&
        matchConfidence < 70;

      let resolvedStatus: string =
        existing?.status === 'disputed' || existing?.status === 'dead'
          ? existing.status
          : lowConfidenceManual
          ? 'unverified'
          : 'active';

      // Manual high-confidence can lift unverified → active
      if (
        evidence === 'manual' &&
        existing?.status === 'unverified' &&
        !lowConfidenceManual
      ) {
        resolvedStatus = 'active';
      }

      const row = {
        source_marketplace: sourceMarketplace,
        source_product_id: sourceProductId,
        target_marketplace: targetMarketplace,
        target_product_id: targetProductId,
        target_url: targetUrl,
        confidence: matchConfidence ?? confidence,
        hits: (existing?.hits ?? 0) + 1,
        rank: lowConfidenceManual ? Math.max(rank, 1) : rank,
        status: resolvedStatus,
        evidence: resolvedEvidence,
        fail_count: existing?.fail_count ?? 0,
        last_verified_at: now,
        updated_at: now,
      };

      const { error } = await supabase.from('cross_market_mapping').upsert(row, {
        onConflict: 'source_marketplace,source_product_id,target_marketplace,target_product_id',
      });

      if (error) {
        console.error('cross_market_mapping upsert', error);
        return jsonResponse({ ok: false, error: 'Write failed' }, 500);
      }

      const alternates = Array.isArray(body.alternates) ? body.alternates.slice(0, MAX_ALTERNATES) : [];
      for (let i = 0; i < alternates.length; i++) {
        const alt = alternates[i];
        const altId = String(alt?.targetProductId ?? '').slice(0, 64);
        const altUrl = String(alt?.targetUrl ?? '').slice(0, 500);
        if (!altId || !altUrl || altId === targetProductId) continue;

        const { data: altExisting } = await supabase
          .from('cross_market_mapping')
          .select('status')
          .eq('source_marketplace', sourceMarketplace)
          .eq('source_product_id', sourceProductId)
          .eq('target_marketplace', targetMarketplace)
          .eq('target_product_id', altId)
          .maybeSingle();

        if (altExisting?.status === 'disputed' || altExisting?.status === 'dead') continue;
        if (evidence === 'auto') {
          if (
            await hasRecentRejectFeedback(supabase, {
              sourceMarketplace,
              sourceProductId,
              targetMarketplace,
              targetProductId: altId,
            })
          ) {
            continue;
          }
        }

        await supabase.from('cross_market_mapping').upsert(
          {
            source_marketplace: sourceMarketplace,
            source_product_id: sourceProductId,
            target_marketplace: targetMarketplace,
            target_product_id: altId,
            target_url: altUrl,
            confidence:
              alt.confidence != null ? Math.round(Number(alt.confidence)) : confidence,
            hits: 1,
            rank: i + 1,
            status: 'active',
            evidence,
            fail_count: 0,
            last_verified_at: now,
            updated_at: now,
          },
          {
            onConflict:
              'source_marketplace,source_product_id,target_marketplace,target_product_id',
          },
        );
      }

      const sourceUrl = String(body.sourceUrl ?? '').trim();
      if (sourceUrl.startsWith('http') && rank === 0 && evidence === 'manual') {
        await supabase.from('cross_market_mapping').upsert(
          {
            source_marketplace: targetMarketplace,
            source_product_id: targetProductId,
            target_marketplace: sourceMarketplace,
            target_product_id: sourceProductId,
            target_url: sourceUrl.slice(0, 500),
            confidence,
            hits: 1,
            rank: 0,
            status: 'active',
            evidence,
            fail_count: 0,
            last_verified_at: now,
            updated_at: now,
          },
          {
            onConflict:
              'source_marketplace,source_product_id,target_marketplace,target_product_id',
          },
        );
      }

      return jsonResponse({ ok: true });
    }

    if (action === 'dispute' || action === 'reportFail') {
      const targetProductId = String(body.targetProductId ?? '').slice(0, 64);
      const targetUrl = String(body.targetUrl ?? '');
      if (!targetProductId && !targetUrl) {
        return jsonResponse({ ok: false, error: 'targetProductId or targetUrl required' }, 400);
      }

      if (authUserId && targetProductId) {
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const { data: recent } = await supabase
          .from('mapping_moderation_events')
          .select('id')
          .eq('user_id', authUserId)
          .eq('action', action)
          .eq('source_marketplace', sourceMarketplace)
          .eq('source_product_id', sourceProductId)
          .eq('target_marketplace', targetMarketplace)
          .eq('target_product_id', targetProductId)
          .gte('created_at', since)
          .limit(1);
        if (recent?.length) {
          return jsonResponse({
            ok: false,
            code: 'moderation_cooldown',
            error: 'Повторный dispute/reportFail по этому mapping можно через 24 часа',
          }, 429);
        }
      }

      let query = supabase
        .from('cross_market_mapping')
        .select('target_product_id, fail_count, target_url, confidence, hits')
        .eq('source_marketplace', sourceMarketplace)
        .eq('source_product_id', sourceProductId)
        .eq('target_marketplace', targetMarketplace);

      if (targetProductId) query = query.eq('target_product_id', targetProductId);

      const { data: rows, error: readErr } = await query.limit(5);
      if (readErr) {
        console.error('cross_market_mapping dispute read', readErr);
        return jsonResponse({ ok: false, error: 'Read failed' }, 500);
      }

      const matched = (rows ?? []).filter((r) => {
        if (targetProductId && r.target_product_id === targetProductId) return true;
        if (targetUrl && r.target_url && targetUrl.includes(r.target_product_id)) return true;
        if (targetUrl && r.target_url === targetUrl) return true;
        return !targetProductId && Boolean(targetUrl);
      });

      const toUpdate = matched.length ? matched : rows ?? [];
      const now = new Date().toISOString();

      for (const row of toUpdate) {
        if (action === 'dispute') {
          const demoted = demoteOnDispute(row);
          await supabase
            .from('cross_market_mapping')
            .update({
              status: 'disputed',
              confidence: demoted.confidence,
              hits: demoted.hits,
              updated_at: now,
            })
            .eq('source_marketplace', sourceMarketplace)
            .eq('source_product_id', sourceProductId)
            .eq('target_marketplace', targetMarketplace)
            .eq('target_product_id', row.target_product_id);
        } else {
          const fails = (row.fail_count ?? 0) + 1;
          await supabase
            .from('cross_market_mapping')
            .update({
              fail_count: fails,
              status: fails >= 3 ? 'dead' : 'active',
              updated_at: now,
            })
            .eq('source_marketplace', sourceMarketplace)
            .eq('source_product_id', sourceProductId)
            .eq('target_marketplace', targetMarketplace)
            .eq('target_product_id', row.target_product_id);
        }

        if (authUserId) {
          await supabase.from('mapping_moderation_events').insert({
            user_id: authUserId,
            action,
            source_marketplace: sourceMarketplace,
            source_product_id: sourceProductId,
            target_marketplace: targetMarketplace,
            target_product_id: row.target_product_id,
          });
        }
      }

      if (action === 'dispute' && toUpdate.length === 0 && targetProductId) {
        const stubUrl =
          targetUrl && targetUrl.startsWith('http')
            ? targetUrl.slice(0, 500)
            : `https://www.ozon.ru/product/${targetProductId}/`;
        await supabase.from('cross_market_mapping').upsert(
          {
            source_marketplace: sourceMarketplace,
            source_product_id: sourceProductId,
            target_marketplace: targetMarketplace,
            target_product_id: targetProductId,
            target_url: stubUrl,
            confidence: 0,
            hits: 0,
            rank: 0,
            status: 'disputed',
            evidence: 'auto',
            fail_count: 0,
            updated_at: now,
          },
          {
            onConflict:
              'source_marketplace,source_product_id,target_marketplace,target_product_id',
          },
        );
        if (authUserId) {
          await supabase.from('mapping_moderation_events').insert({
            user_id: authUserId,
            action: 'dispute',
            source_marketplace: sourceMarketplace,
            source_product_id: sourceProductId,
            target_marketplace: targetMarketplace,
            target_product_id: targetProductId,
          });
        }
      }

      return jsonResponse({ ok: true, updated: toUpdate.length });
    }

    return jsonResponse({ ok: false, error: 'Unknown action' }, 400);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg === 'auth_required' || msg === 'invalid_token') {
      return jsonResponse({ ok: false, error: 'Требуется авторизация' }, 401);
    }
    console.error('cross-market-map error', error);
    return jsonResponse({ ok: false, error: 'Server error' }, 500);
  }
});
