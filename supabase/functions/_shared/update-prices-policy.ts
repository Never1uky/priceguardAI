export const DEFAULT_UPDATE_PRICES_RUNTIME_BUDGET_MS = 115_000;
export const DEFAULT_UPDATE_PRICES_MAX_GROUPS = 160;
export const OOS_REASON = 'out_of_stock_or_unavailable';

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
