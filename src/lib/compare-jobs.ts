import { checkComparePriceDrops } from '@/lib/compare-price-alerts';
import { refreshCompareProduct } from '@/lib/compare-service';
import { settleCompareProductLoading } from '@/lib/compare-offers';
import { getCompareProducts, updateCompareProduct } from '@/lib/comparison-storage';
import {
  addRunningId,
  keepAliveShouldStart,
  keepAliveShouldStop,
  normalizeRunningAtMap,
  normalizeRunningIds,
  pruneStaleRunning,
  removeRunningId,
  type RunningAtMap,
} from '@/lib/compare-running-state';
import { closeHiddenBrowserIfIdle } from '@/lib/hidden-browser';
import {
  clearTelemetryContext,
  newTraceId,
  setTelemetryContext,
  telemetry,
} from '@/lib/telemetry';
import type { CompareProduct, ComparisonMarketplace } from '@/types/comparison';

/** Legacy single-id key — still written as primary id for older readers; prefer IDS. */
export const RUNNING_KEY = 'priceguard_compare_running';
export const RUNNING_IDS_KEY = 'priceguard_compare_running_ids';
export const RUNNING_AT_KEY = 'priceguard_compare_running_at';
export const RUNNING_AT_MAP_KEY = 'priceguard_compare_running_at_map';
export const SEARCHING_MP_KEY = 'priceguard_compare_searching_mp';
/** Идёт параллельный поиск на нескольких площадках (не источник) */
export const SEARCHING_MP_CROSS = 'cross' as const;
export type SearchingMarketplaceKey =
  | import('@/types/comparison').ComparisonMarketplace
  | typeof SEARCHING_MP_CROSS;
/** Если фоновая задача зависла (SW перезапустился) — разблокировать кнопку */
const RUNNING_STALE_MS = 4 * 60 * 1000;

let keepAliveTimer: ReturnType<typeof setInterval> | null = null;
/** Refcount: jobIds holding SW keepAlive. */
const keepAliveJobs = new Set<string>();

function startKeepAlive(jobId: string): void {
  keepAliveJobs.add(jobId);
  // Start timer only when first job acquires keepAlive (refcount 0→1).
  if (!keepAliveShouldStart(keepAliveJobs.size) || keepAliveTimer) return;
  keepAliveTimer = setInterval(() => {
    chrome.runtime.getPlatformInfo(() => {});
  }, 20_000);
}

function stopKeepAlive(jobId: string): void {
  keepAliveJobs.delete(jobId);
  if (!keepAliveShouldStop(keepAliveJobs.size)) return;
  if (keepAliveTimer) {
    clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  }
}

async function readRunningState(): Promise<{ ids: string[]; startedAt: RunningAtMap }> {
  const stored = await chrome.storage.local.get([
    RUNNING_KEY,
    RUNNING_IDS_KEY,
    RUNNING_AT_KEY,
    RUNNING_AT_MAP_KEY,
  ]);
  const fromIds = normalizeRunningIds(stored[RUNNING_IDS_KEY]);
  const fromLegacy = normalizeRunningIds(stored[RUNNING_KEY]);
  const ids = fromIds.length ? fromIds : fromLegacy;
  const startedAt = normalizeRunningAtMap(
    stored[RUNNING_AT_MAP_KEY] ?? stored[RUNNING_AT_KEY],
    ids,
    Date.now(),
  );
  return { ids, startedAt };
}

/** Serialize storage RMW so parallel finally cannot clobber sibling ids. */
let runningStateChain: Promise<void> = Promise.resolve();

function withRunningStateLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = runningStateChain.then(fn, fn);
  runningStateChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function writeRunningState(ids: string[], startedAt: RunningAtMap): Promise<void> {
  if (!ids.length) {
    await chrome.storage.local.remove([
      RUNNING_KEY,
      RUNNING_IDS_KEY,
      RUNNING_AT_KEY,
      RUNNING_AT_MAP_KEY,
      SEARCHING_MP_KEY,
    ]);
    return;
  }
  // Legacy single key = first id (UI that only reads string still sees "something running")
  await chrome.storage.local.set({
    [RUNNING_IDS_KEY]: ids,
    [RUNNING_KEY]: ids[0]!,
    [RUNNING_AT_MAP_KEY]: startedAt,
    [RUNNING_AT_KEY]: startedAt[ids[0]!] ?? Date.now(),
  });
}

/**
 * All product ids with an active compare job (after stale prune).
 */
export async function getRunningCompareProductIds(): Promise<string[]> {
  return withRunningStateLock(async () => {
    const { ids, startedAt } = await readRunningState();
    const pruned = pruneStaleRunning(ids, startedAt, Date.now(), RUNNING_STALE_MS);
    if (pruned.pruned.length || pruned.ids.length !== ids.length) {
      await writeRunningState(pruned.ids, pruned.startedAt);
    }
    return pruned.ids;
  });
}

/** Any running product id, or null if none (for “is compare busy?” gates). */
export async function getRunningCompareProductId(): Promise<string | null> {
  const ids = await getRunningCompareProductIds();
  return ids[0] ?? null;
}

export async function isCompareRunning(productId: string): Promise<boolean> {
  const ids = await getRunningCompareProductIds();
  return ids.includes(productId);
}

export async function clearCompareRunning(): Promise<void> {
  await withRunningStateLock(async () => {
    await chrome.storage.local.remove([
      RUNNING_KEY,
      RUNNING_IDS_KEY,
      RUNNING_AT_KEY,
      RUNNING_AT_MAP_KEY,
      SEARCHING_MP_KEY,
    ]);
  });
}

/** Remove specific product ids from the running set (does not wipe sibling jobs). */
export async function clearCompareRunningForProducts(productIds: Iterable<string>): Promise<void> {
  const toClear = new Set([...productIds].filter((id) => typeof id === 'string' && id.length > 0));
  if (!toClear.size) return;
  await withRunningStateLock(async () => {
    const { ids, startedAt } = await readRunningState();
    let nextIds = ids;
    let nextAt = startedAt;
    let changed = false;
    for (const id of toClear) {
      if (!nextIds.includes(id)) continue;
      const next = removeRunningId(nextIds, nextAt, id);
      nextIds = next.ids;
      nextAt = next.startedAt;
      changed = true;
    }
    if (changed) await writeRunningState(nextIds, nextAt);
  });
}

async function addCompareRunning(productId: string): Promise<void> {
  await withRunningStateLock(async () => {
    const { ids, startedAt } = await readRunningState();
    const next = addRunningId(ids, startedAt, productId, Date.now());
    await writeRunningState(next.ids, next.startedAt);
  });
}

async function removeCompareRunning(productId: string): Promise<void> {
  await clearCompareRunningForProducts([productId]);
}

/** Запуск сравнения в фоне — не зависит от открытого popup. */
let compareJobGeneration = 0;
const activeCompareGenerations = new Map<string, number>();

export async function runCompareJob(
  product: CompareProduct,
  force = true,
  mode: 'refresh' | 'research' = 'refresh',
  options?: { onlyMarketplaces?: ComparisonMarketplace[] },
): Promise<void> {
  const startedAt = Date.now();
  const traceId = newTraceId();
  const jobId = `${product.id}:${traceId}`;

  const alreadySame = await isCompareRunning(product.id);
  if (alreadySame && !force) {
    telemetry.info({
      stage: 'job',
      name: 'JOB_SKIPPED',
      productId: product.id,
      data: { reason: 'same_already_running', mode },
      ctx: { traceId, jobId },
    });
    return;
  }

  // Different products may run in parallel (force or not). Same product + force supersedes via generation.
  // Legacy "other_product_running" skip only when !force AND we still want serialize — plan allows parallel.
  // Keep soft skip only for same id without force (above).

  const generation = ++compareJobGeneration;
  activeCompareGenerations.set(product.id, generation);
  setTelemetryContext({
    traceId,
    jobId,
    productId: product.id,
    marketplace: product.sourceMarketplace,
  });

  telemetry.info({
    stage: 'job',
    name: 'JOB_START',
    productId: product.id,
    marketplace: product.sourceMarketplace,
    data: {
      mode,
      force,
      onlyMarketplaces: options?.onlyMarketplaces,
      generation,
    },
    ctx: { traceId, jobId },
  });

  await addCompareRunning(product.id);
  startKeepAlive(jobId);

  // Winning generation: settle leftover loading_card from a superseded job
  try {
    const list = await getCompareProducts();
    const current = list.find((p) => p.id === product.id);
    if (current) {
      const settled = settleCompareProductLoading(current);
      if (settled !== current) await updateCompareProduct(settled);
    }
  } catch {
    // soft
  }

  try {
    const result = await refreshCompareProduct(product, force, {
      mode,
      onlyMarketplaces: options?.onlyMarketplaces,
      onProgress: async (updated) => {
        if (activeCompareGenerations.get(product.id) !== generation) return;
        await updateCompareProduct(updated);
      },
    });

    if (activeCompareGenerations.get(product.id) !== generation) {
      telemetry.warn({
        stage: 'job',
        name: 'JOB_SUPERSEDED',
        productId: product.id,
        elapsedMs: Date.now() - startedAt,
        data: { generation },
        ctx: { traceId, jobId },
      });
      return;
    }
    await checkComparePriceDrops(product, result.offers);
    telemetry.info({
      stage: 'job',
      name: 'JOB_END',
      productId: product.id,
      success: true,
      elapsedMs: Date.now() - startedAt,
      data: {
        mode,
        offerStatuses: result.offers.map((o) => ({
          mp: o.marketplace,
          status: o.matchStatus,
          found: Boolean(o.found),
        })),
      },
      ctx: { traceId, jobId },
    });
  } catch (error) {
    telemetry.error({
      stage: 'job',
      name: 'JOB_ERROR',
      productId: product.id,
      success: false,
      elapsedMs: Date.now() - startedAt,
      errorCode: 'job_exception',
      error,
      ctx: { traceId, jobId },
    });
    console.warn('[PriceGuard] compare job:', error);
    try {
      if (activeCompareGenerations.get(product.id) === generation) {
        const list = await getCompareProducts();
        const current = list.find((p) => p.id === product.id);
        if (current) {
          await updateCompareProduct(settleCompareProductLoading(current));
        }
      }
    } catch {
      // soft
    }
  } finally {
    const stillOwner = activeCompareGenerations.get(product.id) === generation;
    if (stillOwner) {
      activeCompareGenerations.delete(product.id);
      try {
        const list = await getCompareProducts();
        const current = list.find((p) => p.id === product.id);
        if (current?.marketplaceOffers) {
          const settled = settleCompareProductLoading(current);
          if (settled !== current) await updateCompareProduct(settled);
        }
      } catch {
        // soft
      }
      // Only remove this product from the running set — never wipe other jobs.
      if (await isCompareRunning(product.id)) {
        await removeCompareRunning(product.id);
      }
      stopKeepAlive(jobId);
    } else if (!activeCompareGenerations.has(product.id)) {
      // Superseded and no newer generation active — settle orphan loading_card
      try {
        const list = await getCompareProducts();
        const current = list.find((p) => p.id === product.id);
        if (current) {
          const settled = settleCompareProductLoading(current);
          if (settled !== current) await updateCompareProduct(settled);
        }
      } catch {
        // soft
      }
      if (await isCompareRunning(product.id)) {
        await removeCompareRunning(product.id);
      }
      stopKeepAlive(jobId);
    } else {
      // Superseded by a newer generation of the SAME product — that generation owns keepAlive/running.
      // Still drop this jobId from keepAlive refcount so we don't leak the timer.
      stopKeepAlive(jobId);
    }
    try {
      void closeHiddenBrowserIfIdle();
    } catch {
      // soft
    }
    clearTelemetryContext(['traceId', 'jobId', 'productId', 'marketplace']);
  }
}
