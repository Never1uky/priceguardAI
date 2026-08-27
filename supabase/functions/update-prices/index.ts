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
  DEFAULT_UPDATE_PRICES_CONCURRENCY,
  DEFAULT_UPDATE_PRICES_MAX_GROUPS,
  DEFAULT_UPDATE_PRICES_RUNTIME_BUDGET_MS,
  decideUpdatePricesLock,
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
import {
  DEFAULT_SCRAPPEY_CIRCUIT_OPEN_AFTER,
  maySendPriceAlert,
  shouldOpenScrappeyCircuit,
  softFailureTrackedPatch,
} from '../_shared/update-prices-failure.ts';
import { coalesceTrackedSkuGroups } from '../_shared/update-prices-coalesce.ts';
import {
  loadCostGuards,
  scraperForMarketplace,
  trackLimitForPlan,
} from '../_shared/cost-guards.ts';
import {
  isMonitoringAllowed,
  loadMarketplaceFlags,
  marketplaceFlagsPublicPayload,
} from '../_shared/marketplace-flags.ts';
import {
  insertOpsTelemetry,
  monitorScrapeOpsEvents,
  type OpsTelemetryInput,
} from '../_shared/ops-telemetry.ts';

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

/** Не спамить target-алертом чаще раза в сутки, пока цена ≤ цели */
const TARGET_ALERT_COOLDOWN_MS = 24 * 60 * 60 * 1000;
/** Не слать повторный drop на ту же (или близкую) цену чаще этого */
const DROP_ALERT_COOLDOWN_MS = 8 * 60 * 60 * 1000;

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
    const costGuards = await loadCostGuards(supabase);
    const mpFlags = await loadMarketplaceFlags(supabase);
    const PRICE_FRESH_MS_PREMIUM = costGuards.freshMsPremium;
    const PRICE_FRESH_MS_FREE = costGuards.freshMsFree;
    const maxGroupsPerRun = parsePositiveIntEnv(
      Deno.env.get('UPDATE_PRICES_MAX_GROUPS_PER_RUN'),
      costGuards.maxGroupsPerRun || DEFAULT_UPDATE_PRICES_MAX_GROUPS,
    );

    const lockTtlSeconds = Math.max(180, Math.ceil(runtimeBudgetMs / 1000) + 60);
    const { data: lockAcquired, error: lockError } = await supabase.rpc(
      'try_acquire_update_prices_lock',
      { ttl_seconds: lockTtlSeconds, p_locked_by: 'update-prices' },
    );
    const lockDecision = decideUpdatePricesLock(lockAcquired, lockError);
    if (lockDecision.action === 'skip') {
      return jsonResponse({ ok: true, note: lockDecision.note });
    }
    if (lockDecision.action === 'proceed_with_lock') {
      lockHeld = true;
    } else if (lockError) {
      console.warn('[update-prices] lock acquire error; continuing without exclusive lease', lockError);
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

    // Phase 13: active trial gets Premium track/freshness tier on cron
    const { data: trialRows } = await supabase
      .from('trial_claims')
      .select('user_id')
      .in('user_id', userIds)
      .gt('expires_at', nowIso);
    for (const t of trialRows ?? []) {
      const uid = String((t as { user_id?: string }).user_id ?? '');
      if (uid) premiumActive.add(uid);
    }

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
      list = list.slice(0, trackLimitForPlan(costGuards, isPremium));
      for (const row of list) {
        workQueue.push({ row, priority: isPremium });
      }
    }

    stats.products = workQueue.length;

    // Shared monitoring: one Scrappey/fetch per marketplace+bare product_id, fan-out alerts
    const groups = coalesceTrackedSkuGroups(workQueue).filter((g) =>
      isMonitoringAllowed(mpFlags, g.marketplace, costGuards.monitoringMarketplaces)
    );
    const totalGroups = groups.length;
    const groupsForRun = groups.slice(0, maxGroupsPerRun);
    let processedGroups = 0;
    let earlyStopped = false;
    let stopReason: 'time_budget' | 'max_groups' | null = null;

    if (groupsForRun.length < totalGroups) {
      earlyStopped = true;
      stopReason = 'max_groups';
    }

    const CONCURRENCY = parsePositiveIntEnv(
      Deno.env.get('UPDATE_PRICES_CONCURRENCY'),
      DEFAULT_UPDATE_PRICES_CONCURRENCY,
    );
    const circuitOpenAfter = parsePositiveIntEnv(
      Deno.env.get('UPDATE_PRICES_SCRAPPEY_CIRCUIT_AFTER'),
      costGuards.scrappeyCircuitAfter || DEFAULT_SCRAPPEY_CIRCUIT_OPEN_AFTER,
    );
    /** Soft scrape failures this run — opens circuit to stop Scrappey storm */
    let scrapeSoftFailures = 0;
    let scrappeyCircuitOpen = false;
    const opsEvents: OpsTelemetryInput[] = [];
    const pushOps = (...events: OpsTelemetryInput[]) => {
      opsEvents.push(...events);
    };

    // Extracted so groups within a batch can run concurrently via Promise.all —
    // groups are independent (unique marketplace+product_id, disjoint tracked_products
    // rows), so there is no shared mutable state at risk here besides `stats`, whose
    // increments are synchronous (no await mid-increment) and therefore race-free.
    // scrapeSoftFailures / scrappeyCircuitOpen: best-effort circuit (may race slightly
    // under concurrency; still bounds total Scrappey burn within a run).
    const processGroup = async (group: (typeof groups)[number]): Promise<void> => {
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
      let fetchHardError = false;

      // E5: scrape only if at least one subscriber is stale (tier-aware + OOS backoff)
      if (staleRows.length > 0) {
        const useScraper = scrappeyCircuitOpen
          ? null
          : scraperForMarketplace(costGuards, group.marketplace, projectScraper);
        try {
          fetched = await raceWithTimeout(
            fetchMarketplacePriceDetailed(
              group.marketplace,
              group.productId,
              group.productUrl,
              {
                scraper: useScraper,
                supabase,
                cacheTtlMs: costGuards.priceCacheTtlMs,
              },
            ),
            skuFetchTimeoutMs,
          );
          stats.checked += 1;
          if (fetched?.source) {
            stats.bySource[fetched.source] = (stats.bySource[fetched.source] ?? 0) + 1;
          }
          pushOps(
            ...monitorScrapeOpsEvents({
              marketplace: group.marketplace,
              source: fetched?.source ?? null,
              subscriber_count: group.rows.length,
              stale_count: staleRows.length,
              scrappey: Boolean(useScraper),
            }),
          );
          if (isUnavailablePriceResult(fetched)) {
            scrapeSoftFailures += 1;
            if (shouldOpenScrappeyCircuit(scrapeSoftFailures, circuitOpenAfter)) {
              scrappeyCircuitOpen = true;
            }
          } else {
            scrapeSoftFailures = 0;
          }
        } catch (error) {
          if (isTimeoutError(error)) {
            fetchTimedOut = true;
            console.warn('[update-prices] sku fetch timeout', group.key);
          } else {
            fetchHardError = true;
            console.warn('[update-prices] sku fetch error', group.key, error);
          }
          pushOps({
            name: 'telegram_monitor_error',
            marketplace: group.marketplace,
            success: false,
            stage: 'telegram',
            error_code: isTimeoutError(error) ? 'timeout' : 'fetch_exception',
            payload: {
              subscriber_count: group.rows.length,
              stale_count: staleRows.length,
              reason: isTimeoutError(error) ? 'timeout' : 'fetch_exception',
            },
          });
          scrapeSoftFailures += 1;
          if (shouldOpenScrappeyCircuit(scrapeSoftFailures, circuitOpenAfter)) {
            scrappeyCircuitOpen = true;
          }
        }
      } else {
        pushOps(
          ...monitorScrapeOpsEvents({
            marketplace: group.marketplace,
            source: null,
            subscriber_count: group.rows.length,
            stale_count: 0,
          }),
        );
      }

      const applySoftFailure = async (
        rows: typeof staleRows,
        reason: string,
      ): Promise<void> => {
        for (const { row } of rows) {
          const mp = group.marketplace;
          stats.errors += 1;
          stats.errorsByMarketplace[mp] = (stats.errorsByMarketplace[mp] ?? 0) + 1;
          try {
            await supabase
              .from('tracked_products')
              .update(
                softFailureTrackedPatch({
                  nowIso,
                  consecutiveUnavailableCount: row.consecutive_unavailable_count ?? 0,
                  unavailableSince: row.unavailable_since,
                  reason,
                }),
              )
              .eq('id', row.id);
          } catch {
            // ignore secondary write failure
          }
        }
      };

      if (fetchTimedOut) {
        await applySoftFailure(staleRows, FETCH_TIMEOUT_REASON);
        processedGroups += 1;
        return;
      }

      if (fetchHardError) {
        await applySoftFailure(staleRows, 'fetch_exception');
        processedGroups += 1;
        return;
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
              // Soft: cooldown via last_checked + counter; keep last_price (no false alert)
              await supabase
                .from('tracked_products')
                .update(
                  softFailureTrackedPatch({
                    nowIso,
                    consecutiveUnavailableCount: row.consecutive_unavailable_count ?? 0,
                    unavailableSince: row.unavailable_since,
                    reason: OOS_REASON,
                  }),
                )
                .eq('id', row.id);
            }
            continue;
          }

          if (!maySendPriceAlert(fetched)) {
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
              .update(
                softFailureTrackedPatch({
                  nowIso,
                  consecutiveUnavailableCount: row.consecutive_unavailable_count ?? 0,
                  unavailableSince: row.unavailable_since,
                  reason: `identity:${identity.reason}`,
                }),
              )
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
              pushOps({
                name: 'telegram_alert_sent',
                marketplace: mp,
                success: true,
                stage: 'telegram',
                payload: { alert_type: 'price_drop', subscriber_count: 1 },
              });
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
              pushOps({
                name: 'telegram_alert_sent',
                marketplace: mp,
                success: true,
                stage: 'telegram',
                payload: { alert_type: 'target_price', subscriber_count: 1 },
              });
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
              .update(
                softFailureTrackedPatch({
                  nowIso,
                  consecutiveUnavailableCount: row.consecutive_unavailable_count ?? 0,
                  unavailableSince: row.unavailable_since,
                  reason: error instanceof Error
                    ? error.message.slice(0, 200)
                    : 'fetch_exception',
                }),
              )
              .eq('id', row.id);
          } catch {
            // ignore secondary write failure
          }
        }
      }

      processedGroups += 1;
    };

    for (let batchStart = 0; batchStart < groupsForRun.length; batchStart += CONCURRENCY) {
      if (shouldStopByRuntimeBudget(startedAtMs, runtimeBudgetMs)) {
        earlyStopped = true;
        stopReason = 'time_budget';
        break;
      }
      const batch = groupsForRun.slice(batchStart, batchStart + CONCURRENCY);
      await Promise.all(batch.map((group) => processGroup(group)));
    }

    const elapsedMs = Date.now() - startedAtMs;
    const remainingGroups = Math.max(0, totalGroups - processedGroups);
    const opsInserted = await insertOpsTelemetry(supabase, opsEvents);
    return jsonResponse({
      ok: true,
      stats,
      ops_telemetry_inserted: opsInserted,
      scrappeyConfigured: Boolean(projectScraper) && costGuards.scrappeyEnabled,
      uniqueSkus: totalGroups,
      scrappey_circuit_open: scrappeyCircuitOpen,
      scrape_soft_failures: scrapeSoftFailures,
      cost_guards: {
        source: costGuards.source,
        free_track_limit: costGuards.freeTrackLimit,
        premium_track_limit: costGuards.premiumTrackLimit,
        fresh_ms_free: costGuards.freshMsFree,
        fresh_ms_premium: costGuards.freshMsPremium,
        scrappey_enabled: costGuards.scrappeyEnabled,
        monitoring_marketplaces: costGuards.monitoringMarketplaces,
        scrappey_marketplaces: costGuards.scrappeyMarketplaces,
        price_cache_ttl_ms: costGuards.priceCacheTtlMs,
      },
      marketplace_flags: {
        source: mpFlags.source,
        updated_at: mpFlags.updatedAt,
        flags: marketplaceFlagsPublicPayload(mpFlags),
      },
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
