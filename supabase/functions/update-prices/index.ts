/**
 * Server-side price checks for users with Telegram linked.
 *
 * Plan:
 * - Free: alerts yes, up to FREE_TRACK_LIMIT products
 * - Premium: unlimited + processed first (priority)
 *
 * Auth: Authorization Bearer (service_role) OR header x-cron-secret = UPDATE_PRICES_CRON_SECRET
 * Schedule: every 6h via pg_cron / GitHub Actions → POST this function.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { corsHeaders, jsonResponse } from '../_shared/utils.ts';
import {
  fetchMarketplacePriceDetailed,
  isSignificantDrop,
  reconstructUrl,
  type Marketplace,
  type PriceSource,
} from '../_shared/marketplace-prices.ts';
import type { BrightDataCredentials } from '../_shared/brightdata.ts';
import {
  buildPriceDropMessage,
  buildTargetPriceMessage,
  sendTelegramMessage,
} from '../_shared/telegram.ts';
import { appendPriceHistory } from '../_shared/price-history.ts';

/** Free: 3–5 товаров — верхняя граница плана */
const FREE_TRACK_LIMIT = 5;

/** Не спамить target-алертом чаще раза в сутки, пока цена ≤ цели */
const TARGET_ALERT_COOLDOWN_MS = 24 * 60 * 60 * 1000;

interface AlertSettingsRow {
  user_id: string;
  telegram_chat_id: string;
  notifications_enabled: boolean;
  min_drop_rub: number;
  min_drop_percent: number;
}

interface TrackedRow {
  id: string;
  user_id: string;
  marketplace: Marketplace;
  product_id: string;
  product_title: string | null;
  product_url: string | null;
  target_price: number | null;
  last_price: number | null;
  updated_at?: string | null;
  last_checked?: string | null;
  last_target_notified_at?: string | null;
}

interface Stats {
  users: number;
  premiumUsers: number;
  freeUsers: number;
  products: number;
  checked: number;
  updated: number;
  notified: number;
  errors: number;
  errorsByMarketplace: Record<string, number>;
  bySource: Record<PriceSource, number>;
}

function serviceClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
}

function authorizeCron(req: Request): boolean {
  const cronSecret = Deno.env.get('UPDATE_PRICES_CRON_SECRET')?.trim();
  const headerSecret = req.headers.get('x-cron-secret')?.trim();
  if (cronSecret && headerSecret && headerSecret === cronSecret) return true;

  const auth = req.headers.get('Authorization') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim();
  if (serviceKey && auth === `Bearer ${serviceKey}`) return true;

  return false;
}

async function sendPriceDropAlert(
  chatId: string,
  title: string,
  oldPrice: number,
  newPrice: number,
  marketplace: Marketplace,
  url: string,
  priority: boolean,
): Promise<boolean> {
  const result = await sendTelegramMessage({
    chatId,
    text: buildPriceDropMessage({ title, oldPrice, newPrice, marketplace, priority }),
    buttonUrl: url,
    buttonText: '🛒 Открыть товар',
  });
  return result.sent;
}

async function sendTargetAlert(
  chatId: string,
  title: string,
  currentPrice: number,
  targetPrice: number,
  marketplace: Marketplace,
  url: string,
  priority: boolean,
): Promise<boolean> {
  const result = await sendTelegramMessage({
    chatId,
    text: buildTargetPriceMessage({
      title,
      currentPrice,
      targetPrice,
      marketplace,
      priority,
    }),
    buttonUrl: url,
    buttonText: '🛒 Открыть товар',
  });
  return result.sent;
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function fetchFailReason(marketplace: Marketplace): string {
  if (marketplace === 'ozon') return 'ozon_fetch_blocked_or_empty';
  if (marketplace === 'yandex_market') return 'ym_fetch_blocked_or_empty';
  return 'wb_fetch_empty';
}

function shouldSendTargetAlert(row: TrackedRow, nowMs: number): boolean {
  if (!row.last_target_notified_at) return true;
  const last = Date.parse(row.last_target_notified_at);
  if (!Number.isFinite(last)) return true;
  return nowMs - last >= TARGET_ALERT_COOLDOWN_MS;
}

/** Project-level Bright Data Web Unlocker (Supabase secrets). */
function projectScraperCredentials(): BrightDataCredentials | null {
  const apiKey = Deno.env.get('BRIGHTDATA_API_KEY')?.trim() ?? '';
  const zone = Deno.env.get('BRIGHTDATA_ZONE')?.trim() ?? '';
  if (!apiKey || !zone) return null;
  return { apiKey, zone };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Method not allowed' }, 405);
  }

  if (!authorizeCron(req)) {
    return jsonResponse({ ok: false, error: 'Unauthorized' }, 401);
  }

  const stats: Stats = {
    users: 0,
    premiumUsers: 0,
    freeUsers: 0,
    products: 0,
    checked: 0,
    updated: 0,
    notified: 0,
    errors: 0,
    errorsByMarketplace: {},
    bySource: { cache: 0, brightdata: 0, legacy: 0 },
  };

  try {
    const supabase = serviceClient();
    const nowIso = new Date().toISOString();
    const nowMs = Date.now();

    // Free + Premium with Telegram monitoring enabled
    const { data: settingsRows, error: settingsError } = await supabase
      .from('user_alert_settings')
      .select(
        'user_id, telegram_chat_id, notifications_enabled, min_drop_rub, min_drop_percent, server_monitoring, telegram_enabled',
      )
      .eq('server_monitoring', true)
      .eq('telegram_enabled', true)
      .eq('notifications_enabled', true)
      .neq('telegram_chat_id', '');

    if (settingsError) throw settingsError;

    const settings = (settingsRows ?? []).filter((s) =>
      String(s.telegram_chat_id ?? '').trim().length > 0
    ) as Array<AlertSettingsRow & { telegram_enabled: boolean; server_monitoring: boolean }>;

    if (settings.length === 0) {
      return jsonResponse({ ok: true, stats, note: 'no eligible users' });
    }

    const userIds = settings.map((s) => s.user_id);

    const { data: premiumRows, error: premiumError } = await supabase
      .from('user_premium')
      .select('user_id, expires_at')
      .in('user_id', userIds);

    if (premiumError) throw premiumError;

    const premiumActive = new Set(
      (premiumRows ?? [])
        .filter((p) => !p.expires_at || new Date(p.expires_at) > new Date())
        .map((p) => p.user_id as string),
    );

    const projectScraper = projectScraperCredentials();

    // Priority: Premium first, then Free
    const eligibleSettings = [...settings].sort((a, b) => {
      const ap = premiumActive.has(a.user_id) ? 0 : 1;
      const bp = premiumActive.has(b.user_id) ? 0 : 1;
      return ap - bp;
    });

    stats.users = eligibleSettings.length;
    stats.premiumUsers = eligibleSettings.filter((s) => premiumActive.has(s.user_id)).length;
    stats.freeUsers = stats.users - stats.premiumUsers;

    const settingsByUser = new Map(eligibleSettings.map((s) => [s.user_id, s]));

    const { data: products, error: productsError } = await supabase
      .from('tracked_products')
      .select(
        'id, user_id, marketplace, product_id, product_title, product_url, target_price, last_price, updated_at, last_checked, last_target_notified_at',
      )
      .in('user_id', [...settingsByUser.keys()])
      .eq('deleted', false)
      .order('updated_at', { ascending: false });

    if (productsError) throw productsError;

    const byUser = new Map<string, TrackedRow[]>();
    for (const row of (products ?? []) as TrackedRow[]) {
      const list = byUser.get(row.user_id) ?? [];
      list.push(row);
      byUser.set(row.user_id, list);
    }

    const workQueue: Array<{ row: TrackedRow; priority: boolean }> = [];
    for (const settingsRow of eligibleSettings) {
      const isPremium = premiumActive.has(settingsRow.user_id);
      let list = byUser.get(settingsRow.user_id) ?? [];
      if (!isPremium) {
        list = list.slice(0, FREE_TRACK_LIMIT);
      }
      for (const row of list) {
        workQueue.push({ row, priority: isPremium });
      }
    }

    stats.products = workQueue.length;

    for (const { row, priority } of workQueue) {
      const settingsRow = settingsByUser.get(row.user_id);
      if (!settingsRow) continue;

      try {
        const mp = row.marketplace as Marketplace;
        if (!['wildberries', 'ozon', 'yandex_market'].includes(mp)) continue;

        const fetched = await fetchMarketplacePriceDetailed(
          mp,
          row.product_id,
          row.product_url,
          { scraper: projectScraper, supabase },
        );
        stats.checked += 1;

        if (!fetched?.price || fetched.price <= 0) {
          stats.errors += 1;
          stats.errorsByMarketplace[mp] = (stats.errorsByMarketplace[mp] ?? 0) + 1;
          await supabase
            .from('tracked_products')
            .update({
              last_fetch_ok: false,
              last_fetch_error: fetchFailReason(mp),
              updated_at: nowIso,
            })
            .eq('id', row.id);
          await delay(priority ? 300 : 500);
          continue;
        }

        stats.bySource[fetched.source] = (stats.bySource[fetched.source] ?? 0) + 1;

        const previous = row.last_price != null ? Number(row.last_price) : null;
        const url = fetched.url || row.product_url || reconstructUrl(mp, row.product_id);
        const title = (fetched.title || row.product_title || 'Товар').slice(0, 200);

        const patch: Record<string, unknown> = {
          last_price: fetched.price,
          last_checked: nowIso,
          product_title: title,
          product_url: url,
          updated_at: nowIso,
          last_fetch_ok: true,
          last_fetch_error: null,
        };

        void appendPriceHistory(supabase, {
          userId: row.user_id,
          marketplace: mp,
          productId: row.product_id,
          price: fetched.price,
        });

        const chatId = settingsRow.telegram_chat_id.trim();
        const minRub = Number(settingsRow.min_drop_rub) || 100;
        const minPct = Number(settingsRow.min_drop_percent) || 1;

        if (
          previous != null &&
          previous > 0 &&
          isSignificantDrop(previous, fetched.price, minRub, minPct)
        ) {
          const sent = await sendPriceDropAlert(
            chatId,
            title,
            previous,
            fetched.price,
            mp,
            url,
            priority,
          );
          if (sent) stats.notified += 1;
        }

        if (
          row.target_price != null &&
          Number(row.target_price) > 0 &&
          fetched.price <= Number(row.target_price) &&
          shouldSendTargetAlert(row, nowMs)
        ) {
          const sent = await sendTargetAlert(
            chatId,
            title,
            fetched.price,
            Number(row.target_price),
            mp,
            url,
            priority,
          );
          if (sent) {
            stats.notified += 1;
            patch.last_target_notified_at = nowIso;
          }
        }

        await supabase
          .from('tracked_products')
          .update(patch)
          .eq('id', row.id);

        stats.updated += 1;

        await delay(priority ? 500 : 800);
      } catch (error) {
        stats.errors += 1;
        const mp = String(row.marketplace ?? 'unknown');
        stats.errorsByMarketplace[mp] = (stats.errorsByMarketplace[mp] ?? 0) + 1;
        console.warn('[update-prices] product error', row.id, error);
        try {
          await supabase
            .from('tracked_products')
            .update({
              last_fetch_ok: false,
              last_fetch_error: error instanceof Error
                ? error.message.slice(0, 200)
                : 'fetch_exception',
              updated_at: nowIso,
            })
            .eq('id', row.id);
        } catch {
          // ignore secondary write failure
        }
      }
    }

    return jsonResponse({
      ok: true,
      stats,
      brightdataConfigured: Boolean(projectScraper),
    });
  } catch (error) {
    console.error('[update-prices]', error);
    return jsonResponse({
      ok: false,
      error: error instanceof Error ? error.message : 'Server error',
      stats,
    }, 500);
  }
});
