/**
 * Morning digest for opt-in Telegram users (digest_enabled).
 * Auth: x-cron-secret = UPDATE_PRICES_CRON_SECRET OR Bearer service_role
 * Schedule: ~09:00 Europe/Moscow (06:00 UTC) via pg_cron.
 * No Scrappey / no AI — only tracked_products + product_price_history.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { corsHeaders, jsonResponse } from '../_shared/utils.ts';
import { authorizeCronOrServiceRole } from '../_shared/cron-auth.ts';
import { isPremiumRowActive, PREMIUM_ROW_SELECT } from '../_shared/premium-active.ts';
import { loadPriceMins, formatMinStatusLine, classifyPriceVsMin90 } from '../_shared/price-mins.ts';
import { escapeHtml, formatRub, sendTelegramMessage, truncateTitle } from '../_shared/telegram.ts';

const FREE_TRACK_LIMIT = 5;
const PREMIUM_TRACK_LIMIT = 50;
const MS_24H = 24 * 60 * 60 * 1000;

function serviceClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
}

type DigestUser = {
  user_id: string;
  telegram_chat_id: string;
};

type TrackedItem = {
  marketplace: string;
  product_id: string;
  product_title: string | null;
  last_price: number | null;
};

async function priceAbout24hAgo(
  supabase: ReturnType<typeof serviceClient>,
  userId: string,
  marketplace: string,
  productId: string,
): Promise<number | null> {
  const since = new Date(Date.now() - MS_24H * 2).toISOString();
  const target = Date.now() - MS_24H;
  const { data } = await supabase
    .from('product_price_history')
    .select('price, recorded_at')
    .eq('user_id', userId)
    .eq('marketplace', marketplace)
    .eq('product_id', productId)
    .gte('recorded_at', since)
    .order('recorded_at', { ascending: false })
    .limit(40);

  if (!data?.length) return null;
  let best: { price: number; dist: number } | null = null;
  for (const row of data) {
    const at = Date.parse(String(row.recorded_at));
    const price = Number(row.price);
    if (!Number.isFinite(at) || !(price > 0)) continue;
    const dist = Math.abs(at - target);
    if (!best || dist < best.dist) best = { price, dist };
  }
  // Prefer a point at least ~12h old so "24h ago" is meaningful
  if (best && best.dist <= MS_24H * 1.5) return best.price;
  return null;
}

function buildDigestMessage(input: {
  down: Array<{ title: string; delta: number; price: number }>;
  up: Array<{ title: string; delta: number; price: number }>;
  nearMin: Array<{ title: string; line: string }>;
  trackedCount: number;
}): string {
  const lines = [
    '📬 <b>Утренний дайджест PriceGuard</b>',
    '',
    `Отслеживаете: <b>${input.trackedCount}</b>`,
    `📉 Подешевели: <b>${input.down.length}</b> · 📈 Подорожали: <b>${input.up.length}</b>`,
  ];

  if (input.down.length) {
    const top = [...input.down].sort((a, b) => a.delta - b.delta).slice(0, 3);
    lines.push('', '<b>Сильнее всего упали:</b>');
    for (const d of top) {
      lines.push(
        `• ${escapeHtml(truncateTitle(d.title, 60))} — <b>${formatRub(d.price)}</b> (${formatRub(d.delta)})`,
      );
    }
  }

  if (input.nearMin.length) {
    lines.push('', '<b>Близко к минимуму:</b>');
    for (const n of input.nearMin.slice(0, 3)) {
      lines.push(`• ${escapeHtml(truncateTitle(n.title, 60))} — ${escapeHtml(n.line)}`);
    }
  }

  if (!input.down.length && !input.up.length && !input.nearMin.length) {
    lines.push('', 'За сутки заметных изменений нет. Спокойного дня!');
  } else {
    lines.push('', 'Список: «Мои товары» в боте или /status');
  }

  lines.push('', '⭐ <i>без AI · только ваши цены</i>');
  return lines.join('\n');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Method not allowed' }, 405);
  }
  if (!authorizeCronOrServiceRole(req)) {
    return jsonResponse({ ok: false, error: 'Unauthorized' }, 401);
  }

  try {
    const supabase = serviceClient();
    const { data: settings, error } = await supabase
      .from('user_alert_settings')
      .select('user_id, telegram_chat_id, digest_enabled, telegram_enabled, notifications_enabled')
      .eq('digest_enabled', true)
      .eq('telegram_enabled', true)
      .eq('notifications_enabled', true);

    if (error) {
      console.error('[daily-user-digest] settings', error);
      return jsonResponse({ ok: false, error: 'settings_read_failed' }, 500);
    }

    const users: DigestUser[] = (settings ?? [])
      .filter((r) => String(r.telegram_chat_id ?? '').trim().length > 0)
      .map((r) => ({
        user_id: String(r.user_id),
        telegram_chat_id: String(r.telegram_chat_id).trim(),
      }));

    let sent = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const user of users) {
      const { data: premiumRow } = await supabase
        .from('user_premium')
        .select(PREMIUM_ROW_SELECT)
        .eq('user_id', user.user_id)
        .maybeSingle();
      const premium = isPremiumRowActive(premiumRow);
      const limit = premium ? PREMIUM_TRACK_LIMIT : FREE_TRACK_LIMIT;

      const { data: trackedRows } = await supabase
        .from('tracked_products')
        .select('marketplace, product_id, product_title, last_price')
        .eq('user_id', user.user_id)
        .eq('deleted', false)
        .order('updated_at', { ascending: false })
        .limit(limit);

      const items: TrackedItem[] = (trackedRows ?? []).map((r) => ({
        marketplace: String(r.marketplace ?? ''),
        product_id: String(r.product_id ?? ''),
        product_title: (r.product_title as string | null) ?? null,
        last_price: r.last_price == null ? null : Number(r.last_price),
      }));

      if (items.length === 0) {
        skipped += 1;
        continue;
      }

      const down: Array<{ title: string; delta: number; price: number }> = [];
      const up: Array<{ title: string; delta: number; price: number }> = [];
      const nearMin: Array<{ title: string; line: string }> = [];

      for (const item of items) {
        if (!item.marketplace || !item.product_id) continue;
        const title = item.product_title || 'Товар';
        const nowPrice = item.last_price;
        if (nowPrice == null || !(nowPrice > 0)) continue;

        const prev = await priceAbout24hAgo(
          supabase,
          user.user_id,
          item.marketplace,
          item.product_id,
        );
        if (prev != null && prev > 0) {
          const delta = nowPrice - prev;
          if (delta <= -50) down.push({ title, delta, price: nowPrice });
          else if (delta >= 50) up.push({ title, delta, price: nowPrice });
        }

        const mins = await loadPriceMins(supabase, {
          userId: user.user_id,
          marketplace: item.marketplace,
          productId: item.product_id,
        });
        const cls = classifyPriceVsMin90(nowPrice, mins.min90, mins.points90);
        if (cls.status === 'near_min') {
          const line = formatMinStatusLine(nowPrice, mins);
          if (line) nearMin.push({ title, line });
        }
      }

      const text = buildDigestMessage({
        down,
        up,
        nearMin,
        trackedCount: items.length,
      });
      const result = await sendTelegramMessage({
        chatId: user.telegram_chat_id,
        text,
      });
      if (result.sent) sent += 1;
      else {
        errors.push(`${user.user_id}:${result.error ?? 'send_failed'}`);
      }
    }

    return jsonResponse({
      ok: true,
      users: users.length,
      sent,
      skipped,
      errors: errors.slice(0, 10),
    });
  } catch (err) {
    console.error('[daily-user-digest]', err);
    return jsonResponse({ ok: false, error: 'Server error' }, 500);
  }
});
