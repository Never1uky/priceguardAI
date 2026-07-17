// PriceGuard AI — синхронизация отслеживаемых товаров по Supabase Auth (user_id).
//
// Действия (JWT обязателен):
//   { action: 'pull' }  → все записи пользователя (включая tombstone deleted)
//   { action: 'push', items: [...] }  → upsert + возврат актуального состояния
//
// Изоляция: user_id берётся из JWT, клиент не может подменить чужой аккаунт.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { corsHeaders, jsonResponse } from '../_shared/utils.ts';
import { requireAuthUser } from '../_shared/auth.ts';
import { upsertTrackedProduct } from '../_shared/tracked-upsert.ts';

const VALID_MARKETPLACES = ['wildberries', 'ozon', 'yandex_market'];

function serviceClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
}

const SELECT_COLS =
  'marketplace, product_id, product_title, product_url, target_price, last_price, last_checked, notes, deleted, created_at, updated_at';

async function pullItems(
  supabase: ReturnType<typeof serviceClient>,
  userId: string,
  includeDeleted = true,
) {
  let query = supabase
    .from('tracked_products')
    .select(SELECT_COLS)
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });

  if (!includeDeleted) query = query.eq('deleted', false);

  const { data, error } = await query;
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
        if (!VALID_MARKETPLACES.includes(String(row.marketplace)) || !row.productId) {
          continue;
        }

        const saved = await upsertTrackedProduct(supabase, {
          userId,
          marketplace: String(row.marketplace),
          productId: String(row.productId),
          productTitle: row.productTitle ? String(row.productTitle) : null,
          productUrl: row.productUrl ? String(row.productUrl) : null,
          targetPrice: row.targetPrice == null ? null : Number(row.targetPrice),
          lastPrice: row.lastPrice == null ? null : Number(row.lastPrice),
          lastChecked: row.lastChecked
            ? new Date(Number(row.lastChecked)).toISOString()
            : null,
          notes: row.notes ? String(row.notes) : null,
          deleted: Boolean(row.deleted),
          updatedAt: row.updatedAt
            ? new Date(Number(row.updatedAt)).toISOString()
            : nowIso,
        });

        if (!saved.ok) {
          console.error('tracked_products upsert', saved);
          return jsonResponse({
            ok: false,
            error: 'Sync failed',
            detail: saved.error,
            code: saved.code,
          }, 500);
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
    console.error('tracked-sync error', error);
    return jsonResponse({ ok: false, error: 'Server error' }, 500);
  }
});
