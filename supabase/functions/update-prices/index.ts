/**
 * Server-side price checks for users with Telegram linked.
 *
 * Plan:
 * - Free: alerts yes, up to FREE_TRACK_LIMIT products
 * - Premium: up to PREMIUM_TRACK_LIMIT + processed first (priority)
 *
 * Auth: Authorization Bearer (service_role) OR header x-cron-secret = UPDATE_PRICES_CRON_SECRET
 * Schedule: every 6h via pg_cron / GitHub Actions → POST this function.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { corsHeaders, jsonResponse } from '../_shared/utils.ts';
import {
  fetchMarketplacePriceDetailed,
  isSignificantDrop,
  effectiveServerDropThresholds,
  reconstructUrl,
  type Marketplace,
  type PriceSource,
} from '../_shared/marketplace-prices.ts';
import { projectScraperCredentials } from '../_shared/reviews-common.ts';
import {
  buildPriceDropMessage,
  buildTargetPriceMessage,
  sendTelegramMessage,
} from '../_shared/telegram.ts';
import { appendPriceHistory } from '../_shared/price-history.ts';
import {
  fetchedPriceMatchesTracked,
  logPriceIdentityReject,
} from '../_shared/price-identity.ts';
import { isPremiumRowActive, PREMIUM_ROW_SELECT } from '../_shared/premium-active.ts';
import { invalidateProductCacheAnalysis } from '../_shared/product-cache-store.ts';
import { toPrefixedProductId } from '../_shared/product-id.ts';
import { authorizeCronOrServiceRoleDetailed } from '../_shared/cron-auth.ts';
import {
  DEFAULT_SKU_FETCH_TIMEOUT_MS,
  DEFAULT_UPDATE_PRICES_MAX_GROUPS,
  DEFAULT_UPDATE_PRICES_RUNTIME_BUDGET_MS,
  FETCH_TIMEOUT_REASON,
  UPDATE_PRICES_ALREADY_RUNNING_NOTE,
  isPriceRowStale,
  isTimeoutError,
  isUnavailablePriceResult,
  OOS_REASON,
  parsePositiveIntEnv,
  raceWithTimeout,
  shouldStopByRuntimeBudget,
} from '../_shared/update-prices-policy.ts';

/** Match client FULL_ANALYSIS_PRICE_DELTA_* — invalidate AI cache on big moves. */
const AI_CACHE_PRICE_DELTA_PCT = 0.1;
const AI_CACHE_PRICE_DELTA_ABS = 500;

function isSignificantPriceChangeForAiCache(
  previous: number | null,
  next: number,
): boolean {
  if (previous == null || previous <= 0 || next <= 0) return false;
  const abs = Math.abs(next - previous);
  return abs >= AI_CACHE_PRICE_DELTA_ABS || abs >= previous * AI_CACHE_PRICE_DELTA_PCT;
}

/** Skip Telegram for freshly tracked products (Chrome notify is enough client-side). */
const TELEGRAM_ALERT_GRACE_MS = 6 * 60 * 60 * 1000;

function isWithinTelegramGrace(createdAt: string | null | undefined, nowMs: number): boolean {
  if (!createdAt) return false;
  const t = Date.parse(createdAt);
  if (!Number.isFinite(t)) return false;
  const age = nowMs - t;
  return age >= 0 && age < TELEGRAM_ALERT_GRACE_MS;
}

/** Free: 3–5 товаров — верхняя граница плана */
const FREE_TRACK_LIMIT = 5;
const PREMIUM_TRACK_LIMIT = 50;

/** Не спамить target-алертом чаще раза в сутки, пока цена ≤ цели */
const TARGET_ALERT_COOLDOWN_MS = 24 * 60 * 60 * 1000;
/** Не слать повторный drop на ту же (или близкую) цену чаще этого */
const DROP_ALERT_COOLDOWN_MS = 8 * 60 * 60 * 1000;
/** Skip scrape when last_checked is fresher than this (Premium / priority) */
const PRICE_FRESH_MS_PREMIUM = 3 * 60 * 60 * 1000;
/** Free subscribers: rarer cron scrapes */
const PRICE_FRESH_MS_FREE = 6 * 60 * 60 * 1000;

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
  created_at?: string | null;
  last_checked?: string | null;
  last_target_notified_at?: string | null;
  last_drop_notified_at?: string | null;
  last_drop_notified_price?: number | null;
  last_fetch_error?: string | null;
  consecutive_unavailable_count?: number | null;
  unavailable_since?: string | null;
}

interface Stats {
  users: number;
  premiumUsers: number;
  freeUsers: number;
  products: number;
  checked: number;
  updated: number;
  notified: number;
  unavailable: number;
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

function shouldSendTargetAlert(row: TrackedRow, nowMs: number): boolean {
  if (!row.last_target_notified_at) return true;
  const last = Date.parse(row.last_target_notified_at);
  if (!Number.isFinite(last)) return true;
  return nowMs - last >= TARGET_ALERT_COOLDOWN_MS;
}

function shouldSendDropAlert(row: TrackedRow, newPrice: number, nowMs: number): boolean {
  if (!row.last_drop_notified_at) return true;
  const last = Date.parse(row.last_drop_notified_at);
  if (!Number.isFinite(last)) return true;
  if (nowMs - last < DROP_ALERT_COOLDOWN_MS) {
    const prevNotified = row.last_drop_notified_price != null
      ? Number(row.last_drop_notified_price)
      : null;
    // Same price band → suppress; deeper drop can notify again
    if (prevNotified != null && newPrice >= prevNotified * 0.98) return false;
  }
  return true;
}

/** Project-level Scrappey (Supabase secret SCRAPPEY_API_KEY). */

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Method not allowed' }, 405);
  }

  const auth = authorizeCronOrServiceRoleDetailed(req);
  if (!auth.ok) {
    console.warn('[update-prices] unauthorized', {
      reason: auth.reason,
      hasCronHeader: Boolean(req.headers.get('x-cron-secret')),
      hasAuthHeader: Boolean(req.headers.get('Authorization')),
    });
    return jsonResponse({ ok: false, error: 'Unauthorized' }, 401);
  }

  const startedAtMs = Date.now();
  const runtimeBudgetMs = parsePositiveIntEnv(
    Deno.env.get('UPDATE_PRICES_RUNTIME_BUDGET_MS'),
    DEFAULT_UPDATE_PRICES_RUNTIME_BUDGET_MS,
  );
  const maxGroupsPerRun = parsePositiveIntEnv(
    Deno.env.get('UPDATE_PRICES_MAX_GROUPS_PER_RUN'),
    DEFAULT_UPDATE_PRICES_MAX_GROUPS,
  );
  const skuFetchTimeoutMs = parsePositiveIntEnv(
    Deno.env.get('UPDATE_PRICES_SKU_FETCH_TIMEOUT_MS'),
    DEFAULT_SKU_FETCH_TIMEOUT_MS,
  );

  const stats: Stats = {
    users: 0,
    premiumUsers: 0,
    freeUsers: 0,
    products: 0,
    checked: 0,
    updated: 0,
    notified: 0,
    unavailable: 0,
    errors: 0,
    errorsByMarketplace: {},
    bySource: { cache: 0, scrappey: 0, legacy: 0 },
  };

  const supabase = serviceClient();
  let lockHeld = false;

  try {
    const lockTtlSeconds = Math.max(180, Math.ceil(runtimeBudgetMs / 1000) + 60);
    const { data: lockAcquired, error: lockError } = await supabase.rpc(
      'try_acquire_update_prices_lock',
      { ttl_seconds: lockTtlSeconds, p_locked_by: 'update-prices' },
    );
    if (lockError) {
      console.warn('[update-prices] lock acquire error; continuing without exclusive lease', lockError);
    } else if (lockAcquired === false) {
      return jsonResponse({ ok: true, note: UPDATE_PRICES_ALREADY_RUNNING_NOTE });
    } else if (lockAcquired === true) {
      lockHeld = true;
    }

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
      .select(PREMIUM_ROW_SELECT)
      .in('user_id', userIds);

    if (premiumError) throw premiumError;

    const premiumActive = new Set(
      (premiumRows ?? [])
        .filter((p) => isPremiumRowActive(p))
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
        'id, user_id, marketplace, product_id, product_title, product_url, target_price, last_price, updated_at, created_at, last_checked, last_target_notified_at, last_drop_notified_at, last_drop_notified_price, last_fetch_error, consecutive_unavailable_count, unavailable_since',
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
      list = list.slice(0, isPremium ? PREMIUM_TRACK_LIMIT : FREE_TRACK_LIMIT);
      for (const row of list) {
        workQueue.push({ row, priority: isPremium });
      }
    }

    stats.products = workQueue.length;

    // Coalesce scrapes: one fetch per (marketplace, product_id), then fan-out
    type SkuGroup = {
      key: string;
      marketplace: Marketplace;
      productId: string;
      productUrl: string | null;
      priority: boolean;
      rows: Array<{ row: TrackedRow; priority: boolean }>;
    };
    const skuGroups = new Map<string, SkuGroup>();
    for (const item of workQueue) {
      const mp = item.row.marketplace as Marketplace;
      if (!['wildberries', 'ozon', 'yandex_market'].includes(mp)) continue;
      const key = `${mp}:${item.row.product_id}`;
      const existing = skuGroups.get(key);
      if (existing) {
        existing.rows.push(item);
        existing.priority = existing.priority || item.priority;
        if (!existing.productUrl && item.row.product_url) {
          existing.productUrl = item.row.product_url;
        }
      } else {
        skuGroups.set(key, {
          key,
          marketplace: mp,
          productId: item.row.product_id,
          productUrl: item.row.product_url,
          priority: item.priority,
          rows: [item],
        });
      }
    }

    const groups = [...skuGroups.values()];
    const totalGroups = groups.length;
    const groupsForRun = groups.slice(0, maxGroupsPerRun);
    let processedGroups = 0;
    let earlyStopped = false;
    let stopReason: 'time_budget' | 'max_groups' | null = null;

    if (groupsForRun.length < totalGroups) {
      earlyStopped = true;
      stopReason = 'max_groups';
    }

    for (const group of groupsForRun) {
      if (shouldStopByRuntimeBudget(startedAtMs, runtimeBudgetMs)) {
        earlyStopped = true;
        stopReason = 'time_budget';
        break;
      }
      const nowMsInner = Date.now();
      const staleRows = group.rows.filter(({ row, priority }) => {
        const baseFreshMs = priority ? PRICE_FRESH_MS_PREMIUM : PRICE_FRESH_MS_FREE;
        return isPriceRowStale({
          lastChecked: row.last_checked,
          nowMs: nowMsInner,
          baseFreshMs,
          consecutiveUnavailableCount: row.consecutive_unavailable_count ?? 0,
        });
      });

      let fetched: Awaited<ReturnType<typeof fetchMarketplacePriceDetailed>> = null;
      let fetchTimedOut = false;

      // E5: scrape only if at least one subscriber is stale (tier-aware + OOS backoff)
      if (staleRows.length > 0) {
        try {
          fetched = await raceWithTimeout(
            fetchMarketplacePriceDetailed(
              group.marketplace,
              group.productId,
              group.productUrl,
              { scraper: projectScraper, supabase },
            ),
            skuFetchTimeoutMs,
          );
          stats.checked += 1;
          if (fetched?.source) {
            stats.bySource[fetched.source] = (stats.bySource[fetched.source] ?? 0) + 1;
          }
        } catch (error) {
          if (isTimeoutError(error)) {
            fetchTimedOut = true;
            console.warn('[update-prices] sku fetch timeout', group.key);
          } else {
            console.warn('[update-prices] sku fetch error', group.key, error);
          }
        }
      }

      if (fetchTimedOut) {
        for (const { row } of staleRows) {
          const mp = group.marketplace;
          stats.errors += 1;
          stats.errorsByMarketplace[mp] = (stats.errorsByMarketplace[mp] ?? 0) + 1;
          try {
            await supabase
              .from('tracked_products')
              .update({
                last_fetch_ok: false,
                last_fetch_error: FETCH_TIMEOUT_REASON,
                updated_at: nowIso,
              })
              .eq('id', row.id);
          } catch {
            // ignore secondary write failure
          }
        }
        processedGroups += 1;
        await delay(group.priority ? 20 : 40);
        continue;
      }

      for (const { row, priority } of group.rows) {
        const settingsRow = settingsByUser.get(row.user_id);
        if (!settingsRow) continue;
        const mp = group.marketplace;
        const baseFreshMs = priority ? PRICE_FRESH_MS_PREMIUM : PRICE_FRESH_MS_FREE;
        const rowFresh = !isPriceRowStale({
          lastChecked: row.last_checked,
          nowMs: nowMsInner,
          baseFreshMs,
          consecutiveUnavailableCount: row.consecutive_unavailable_count ?? 0,
        });

        // Fresh row + no new scrape → skip (keep last_price)
        if (rowFresh && !fetched) {
          continue;
        }

        try {
          if (isUnavailablePriceResult(fetched)) {
            if (!rowFresh) {
              stats.unavailable += 1;
              const nextCount = (row.consecutive_unavailable_count ?? 0) + 1;
              await supabase
                .from('tracked_products')
                .update({
                  last_fetch_ok: false,
                  last_fetch_error: OOS_REASON,
                  consecutive_unavailable_count: nextCount,
                  unavailable_since: row.unavailable_since ?? nowIso,
                  last_checked: nowIso,
                  updated_at: nowIso,
                })
                .eq('id', row.id);
            }
            continue;
          }

          const previous = row.last_price != null ? Number(row.last_price) : null;
          const url = fetched.url || row.product_url || reconstructUrl(mp, row.product_id);
          const title = (fetched.title || row.product_title || 'Товар').slice(0, 200);

          if (isSignificantPriceChangeForAiCache(previous, fetched.price)) {
            const bare = row.product_id;
            const prefixed = toPrefixedProductId(mp, bare);
            void invalidateProductCacheAnalysis(supabase, mp, bare);
            if (prefixed !== bare) {
              void invalidateProductCacheAnalysis(supabase, mp, prefixed);
            }
          }

          const identity = fetchedPriceMatchesTracked({
            marketplace: mp,
            productId: row.product_id,
            productUrl: row.product_url,
            fetchedUrl: fetched.url || url,
            fetchedTitle: fetched.title,
          });
          if (identity.ok === false) {
            logPriceIdentityReject({
              reason: identity.reason,
              rowId: row.id,
              productId: row.product_id,
              marketplace: mp,
              fetchedUrl: fetched.url,
              title: title.slice(0, 80),
            });
            await supabase
              .from('tracked_products')
              .update({
                last_fetch_ok: false,
                last_fetch_error: `identity:${identity.reason}`,
                updated_at: nowIso,
              })
              .eq('id', row.id);
            stats.errors += 1;
            continue;
          }

          const patch: Record<string, unknown> = {
            last_price: fetched.price,
            last_checked: nowIso,
            product_title: title,
            product_url: url,
            updated_at: nowIso,
            last_fetch_ok: true,
            last_fetch_error: null,
            consecutive_unavailable_count: 0,
            unavailable_since: null,
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
          const { minDropRub, minDropPercent } = effectiveServerDropThresholds(
            mp,
            minRub,
            minPct,
          );

          const alertTitle = (row.product_title || title).slice(0, 200);
          const skipTelegram = isWithinTelegramGrace(row.created_at, nowMs);
          if (skipTelegram) {
            console.info('[PriceGuard] telegram grace skip', {
              rowId: row.id,
              created_at: row.created_at,
            });
          }

          if (
            !skipTelegram &&
            previous != null &&
            previous > 0 &&
            isSignificantDrop(previous, fetched.price, minDropRub, minDropPercent) &&
            shouldSendDropAlert(row, fetched.price, nowMs)
          ) {
            const sent = await sendPriceDropAlert(
              chatId,
              alertTitle,
              previous,
              fetched.price,
              mp,
              url,
              priority,
            );
            if (sent) {
              stats.notified += 1;
              patch.last_drop_notified_at = nowIso;
              patch.last_drop_notified_price = fetched.price;
            }
          }

          if (
            !skipTelegram &&
            row.target_price != null &&
            Number(row.target_price) > 0 &&
            fetched.price <= Number(row.target_price) &&
            shouldSendTargetAlert(row, nowMs)
          ) {
            const sent = await sendTargetAlert(
              chatId,
              alertTitle,
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
        } catch (error) {
          stats.errors += 1;
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

      processedGroups += 1;
      // Keep a small jitter to avoid burst spikes, but not enough to hit 150s runtime limits.
      await delay(group.priority ? 20 : 40);
    }

    const elapsedMs = Date.now() - startedAtMs;
    const remainingGroups = Math.max(0, totalGroups - processedGroups);
    return jsonResponse({
      ok: true,
      stats,
      scrappeyConfigured: Boolean(projectScraper),
      uniqueSkus: skuGroups.size,
      elapsed_ms: elapsedMs,
      runtime_budget_ms: runtimeBudgetMs,
      batch: {
        max_groups_per_run: maxGroupsPerRun,
        total_groups: totalGroups,
        processed_groups: processedGroups,
        remaining_groups: remainingGroups,
        early_stopped: earlyStopped,
        stop_reason: stopReason,
      },
    });
  } catch (error) {
    console.error('[update-prices]', error);
    return jsonResponse({
      ok: false,
      error: error instanceof Error ? error.message : 'Server error',
      stats,
    }, 500);
  } finally {
    if (lockHeld) {
      try {
        await supabase.rpc('release_update_prices_lock');
      } catch (releaseError) {
        console.warn('[update-prices] lock release error', releaseError);
      }
    }
  }
});
