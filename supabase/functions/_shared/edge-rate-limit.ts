/**
 * Shared sliding-window rate limit via edge_request_log.
 */

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

export async function isEdgeRateLimited(
  supabase: SupabaseClient,
  params: {
    endpoint: string;
    userId?: string | null;
    deviceId?: string | null;
    max: number;
    windowMin: number;
    cost?: number;
  },
): Promise<boolean> {
  const { endpoint, userId, deviceId, max, windowMin, cost = 1 } = params;
  if (max <= 0) return false;

  const since = new Date(Date.now() - windowMin * 60_000).toISOString();
  let query = supabase
    .from('edge_request_log')
    .select('id', { count: 'exact', head: true })
    .eq('endpoint', endpoint)
    .gte('created_at', since);

  if (userId) {
    query = query.eq('user_id', userId);
  } else if (deviceId) {
    query = query.eq('device_id', deviceId);
  } else {
    return false;
  }

  const { count, error } = await query;
  if (error) {
    console.warn('[edge-rate-limit] count failed', error);
    return false;
  }
  return (count ?? 0) + cost > max;
}

export async function logEdgeRequest(
  supabase: SupabaseClient,
  params: {
    endpoint: string;
    userId?: string | null;
    deviceId?: string | null;
  },
): Promise<void> {
  const { error } = await supabase.from('edge_request_log').insert({
    endpoint: params.endpoint,
    user_id: params.userId ?? null,
    device_id: params.deviceId ?? null,
  });
  if (error) {
    console.warn('[edge-rate-limit] log failed', error);
  }
}
