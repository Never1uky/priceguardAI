/**
 * Привязка legacy tracked_products (device_id) к user_id при первом входе.
 */

import { callEdgeSafe } from '@/lib/supabase/edge';
import { getDeviceId } from '@/lib/supabase/device-id';
import { getAuthUserIdOrNull } from '@/lib/supabase/auth-guard';

export interface ClaimDeviceResult {
  claimed: number;
  merged: number;
}

/**
 * Перенести облачные записи device_id на текущего пользователя.
 * Вызывается из post-login (один раз на user_id).
 */
export async function claimDeviceTrackedProducts(
  deviceId?: string,
): Promise<ClaimDeviceResult | null> {
  const userId = await getAuthUserIdOrNull();
  if (!userId) return null;

  const id = deviceId ?? (await getDeviceId());
  const res = await callEdgeSafe<{
    ok: boolean;
    claimed?: number;
    merged?: number;
    error?: string;
  }>('claim-device-tracked', { deviceId: id });

  if (!res?.ok) {
    console.warn('[PriceGuard] claim-device-tracked failed', res?.error);
    return null;
  }

  return { claimed: res.claimed ?? 0, merged: res.merged ?? 0 };
}
