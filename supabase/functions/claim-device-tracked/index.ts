// PriceGuard AI — привязка legacy tracked_products (device_id) к user_id при первом входе.
//
// POST { deviceId } + JWT → вызывает RPC claim_tracked_products_by_device

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { corsHeaders, jsonResponse } from '../_shared/utils.ts';
import { requireAuthUser } from '../_shared/auth.ts';

function serviceClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Method not allowed' }, 405);
  }

  try {
    const user = await requireAuthUser(req, true);
    const body = await req.json();
    const deviceId = String(body.deviceId ?? '').slice(0, 64);

    if (!deviceId) {
      return jsonResponse({ ok: false, error: 'deviceId required' }, 400);
    }

    const supabase = serviceClient();
    const { data, error } = await supabase.rpc('claim_tracked_products_by_device', {
      p_device_id: deviceId,
      p_user_id: user!.id,
    });

    if (error) {
      console.error('claim_tracked_products_by_device', error);
      return jsonResponse({ ok: false, error: 'Claim failed' }, 500);
    }

    const result = (data ?? {}) as { claimed?: number; merged?: number };
    console.info(
      `[claim-device-tracked] user=${user!.id} device=${deviceId.slice(0, 8)}… ` +
        `claimed=${result.claimed ?? 0} merged=${result.merged ?? 0}`,
    );

    return jsonResponse({
      ok: true,
      claimed: result.claimed ?? 0,
      merged: result.merged ?? 0,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg === 'auth_required' || msg === 'invalid_token') {
      return jsonResponse({ ok: false, error: 'Требуется авторизация' }, 401);
    }
    console.error('claim-device-tracked error', error);
    return jsonResponse({ ok: false, error: 'Server error' }, 500);
  }
});
