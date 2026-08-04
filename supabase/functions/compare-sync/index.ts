// PriceGuard AI — sync comparison list by Supabase Auth (user_id).
//
// { action: 'pull' } → rows for user (incl. tombstones)
// { action: 'push', items: [{ productId, payload, deleted?, updatedAt? }] }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { corsHeaders, jsonResponse } from '../_shared/utils.ts';
import { requireAuthUser } from '../_shared/auth.ts';

function serviceClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
}

const SELECT_COLS = 'product_id, payload, deleted, created_at, updated_at';

async function pullItems(
  supabase: ReturnType<typeof serviceClient>,
  userId: string,
) {
  const { data, error } = await supabase
    .from('compare_products')
    .select(SELECT_COLS)
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
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
    const userId = user!.id;
    const body = await req.json();
    const action = String(body.action ?? '');
    const supabase = serviceClient();

    if (action === 'pull') {
      const items = await pullItems(supabase, userId);
      return jsonResponse({ ok: true, items });
    }

    if (action === 'push') {
      const incoming = Array.isArray(body.items) ? body.items : [];
      const nowIso = new Date().toISOString();

      for (const it of incoming) {
        if (!it || typeof it !== 'object') continue;
        const row = it as Record<string, unknown>;
        const productId = String(row.productId ?? '').trim().slice(0, 128);
        if (!productId) continue;

        const deleted = Boolean(row.deleted);
        const payload = deleted
          ? {}
          : (row.payload && typeof row.payload === 'object' ? row.payload : {});
        const updatedAt = row.updatedAt
          ? new Date(Number(row.updatedAt)).toISOString()
          : nowIso;

        const { error } = await supabase.from('compare_products').upsert(
          {
            user_id: userId,
            product_id: productId,
            payload,
            deleted,
            updated_at: updatedAt,
          },
          { onConflict: 'user_id,product_id' },
        );

        if (error) {
          console.error('compare_products upsert', error);
          return jsonResponse({ ok: false, error: 'Sync failed', detail: error.message }, 500);
        }
      }

      const items = await pullItems(supabase, userId);
      return jsonResponse({ ok: true, items });
    }

    return jsonResponse({ ok: false, error: 'Unknown action' }, 400);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg === 'auth_required' || msg === 'invalid_token') {
      return jsonResponse({ ok: false, error: 'Требуется авторизация' }, 401);
    }
    console.error('compare-sync error', error);
    return jsonResponse({ ok: false, error: 'Server error' }, 500);
  }
});
