export const DEFAULT_UPDATE_PRICES_RUNTIME_BUDGET_MS = 115_000;
export const DEFAULT_UPDATE_PRICES_MAX_GROUPS = 160;
export const OOS_REASON = 'out_of_stock_or_unavailable';
export const FETCH_TIMEOUT_REASON = 'timeout';
export const UPDATE_PRICES_ALREADY_RUNNING_NOTE = 'already running';

/** Cap OOS scrape backoff at once per 3 days */
export const UNAVAILABLE_BACKOFF_MAX_MS = 3 * 24 * 60 * 60 * 1000;

/** Per-SKU scrape wait before treating as timeout (does not cancel underlying I/O) */
export const DEFAULT_SKU_FETCH_TIMEOUT_MS = 22_000;

export interface PriceLike {
  price?: number | null;
}

export function parsePositiveIntEnv(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return value;
}

export function shouldStopByRuntimeBudget(
  startedAtMs: number,
  budgetMs: number,
  nowMs = Date.now(),
): boolean {
  return nowMs - startedAtMs >= budgetMs;
}

export function isUnavailablePriceResult(result: PriceLike | null | undefined): boolean {
  return !result?.price || result.price <= 0;
}

/**
 * Backoff multiplier after consecutive OOS results.
 * 0–1 failures → normal interval; 2–3 → x4; 4+ → x12.
 */
export function unavailableFreshMsMultiplier(consecutiveUnavailableCount: number): number {
  const count = Number.isFinite(consecutiveUnavailableCount)
    ? Math.max(0, Math.floor(consecutiveUnavailableCount))
    : 0;
  if (count <= 1) return 1;
  if (count <= 3) return 4;
  return 12;
}

export function effectivePriceFreshMs(
  baseFreshMs: number,
  consecutiveUnavailableCount: number,
): number {
  const base = Number.isFinite(baseFreshMs) && baseFreshMs > 0 ? baseFreshMs : 0;
  const scaled = base * unavailableFreshMsMultiplier(consecutiveUnavailableCount);
  return Math.min(scaled, UNAVAILABLE_BACKOFF_MAX_MS);
}

export function isPriceRowStale(args: {
  lastChecked: string | null | undefined;
  nowMs: number;
  baseFreshMs: number;
  consecutiveUnavailableCount?: number | null;
}): boolean {
  if (!args.lastChecked) return true;
  const t = Date.parse(args.lastChecked);
  if (!Number.isFinite(t)) return true;
  const freshMs = effectivePriceFreshMs(
    args.baseFreshMs,
    args.consecutiveUnavailableCount ?? 0,
  );
  return args.nowMs - t >= freshMs;
}

export function isTimeoutError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const err = error as { name?: string; message?: string };
  if (err.name === 'TimeoutError') return true;
  const msg = String(err.message ?? '').toLowerCase();
  return msg === 'timeout' || msg.includes('timeout');
}

/**
 * Race a promise against AbortController timeout.
 * Underlying work may continue; caller stops waiting.
 */
export async function raceWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  const ms = Number.isFinite(timeoutMs) && timeoutMs > 0
    ? timeoutMs
    : DEFAULT_SKU_FETCH_TIMEOUT_MS;

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let settled = false;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      if (settled) return;
      const err = new Error('timeout');
      err.name = 'TimeoutError';
      reject(err);
    }, ms);
  });

  try {
    const result = await Promise.race([promise, timeoutPromise]);
    settled = true;
    return result;
  } catch (error) {
    settled = true;
    throw error;
  } finally {
    settled = true;
    if (timer !== undefined) clearTimeout(timer);
  }
}
