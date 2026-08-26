/**
 * Phase 13 — server track-cap for Free/Premium/trial.
 * Never trust extension-only limits.
 */

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { loadCostGuards, trackLimitForPlan } from './cost-guards.ts';
import { resolveUserPlanAccess } from './premium-active.ts';

export async function countActiveTrackedProducts(
  supabase: SupabaseClient,
  userId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from('tracked_products')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('deleted', false);
  if (error) {
    console.warn('[track-limit] count failed', error.message);
    return 0;
  }
  return count ?? 0;
}

export async function resolveTrackLimitForUser(
  supabase: SupabaseClient,
  userId: string,
): Promise<{
  limit: number;
  premiumTier: boolean;
  kind: 'free' | 'trial' | 'premium';
  activeCount: number;
}> {
  const [guards, plan, activeCount] = await Promise.all([
    loadCostGuards(supabase),
    resolveUserPlanAccess(supabase, userId),
    countActiveTrackedProducts(supabase, userId),
  ]);
  const limit = trackLimitForPlan(guards, plan.premiumTier);
  return {
    limit,
    premiumTier: plan.premiumTier,
    kind: plan.kind,
    activeCount,
  };
}

/** Pure gate for tests */
export function mayInsertTrackedProduct(input: {
  isUpdateOfExisting: boolean;
  willBeDeleted: boolean;
  /** Existing row is currently deleted and would be undeleted */
  isUndelete?: boolean;
  activeCount: number;
  limit: number;
}): { ok: true } | { ok: false; code: 'TRACK_LIMIT' } {
  if (input.willBeDeleted) return { ok: true };
  if (input.isUpdateOfExisting && !input.isUndelete) return { ok: true };
  if (input.activeCount >= input.limit) {
    return { ok: false, code: 'TRACK_LIMIT' };
  }
  return { ok: true };
}
