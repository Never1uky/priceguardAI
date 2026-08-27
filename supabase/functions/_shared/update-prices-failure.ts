/**
 * Soft vs hard fetch failures for Telegram update-prices.
 * Soft failures must NOT trigger price alerts and must apply scrape cooldown
 * (last_checked + consecutive counter) so cron does not burn Scrappey forever.
 */

export const SCRAPE_FAIL_REASON = 'scrape_failed';
export const FETCH_EXCEPTION_REASON = 'fetch_exception';

/** After this many soft failures in one cron run → skip Scrappey for remaining groups */
export const DEFAULT_SCRAPPEY_CIRCUIT_OPEN_AFTER = 8;

export type FetchFailureKind =
  | 'timeout'
  | 'scrappey'
  | 'http_5xx'
  | 'captcha'
  | 'unavailable'
  | 'not_found'
  | 'identity'
  | 'exception';

export function classifyFetchFailure(args: {
  timedOut?: boolean;
  fetchedNull?: boolean;
  lastError?: string | null;
}): { kind: FetchFailureKind; reason: string; soft: boolean } {
  if (args.timedOut) {
    return { kind: 'timeout', reason: 'timeout', soft: true };
  }
  const err = String(args.lastError ?? '').toLowerCase();
  if (err.includes('timeout')) {
    return { kind: 'timeout', reason: 'timeout', soft: true };
  }
  if (err.includes('captcha') || err.includes('still_blocked') || err.includes('challenge')) {
    return { kind: 'captcha', reason: 'captcha_or_block', soft: true };
  }
  if (err.includes('502') || err.includes('503') || err.includes('504') || /5\d\d/.test(err)) {
    return { kind: 'http_5xx', reason: 'http_5xx', soft: true };
  }
  if (err.startsWith('identity:')) {
    return { kind: 'identity', reason: err.slice(0, 80), soft: true };
  }
  if (args.fetchedNull) {
    // Null price: OOS, deleted, or scrape miss — treat as soft (backoff, no alert)
    return { kind: 'unavailable', reason: SCRAPE_FAIL_REASON, soft: true };
  }
  return { kind: 'exception', reason: FETCH_EXCEPTION_REASON, soft: true };
}

/**
 * Patch fields for a soft scrape failure: bump counter, set last_checked
 * (cooldown), never touch last_price (avoids false drop alerts).
 */
export function softFailureTrackedPatch(args: {
  nowIso: string;
  consecutiveUnavailableCount: number;
  unavailableSince: string | null | undefined;
  reason: string;
}): Record<string, unknown> {
  const nextCount = Math.max(0, Math.floor(args.consecutiveUnavailableCount)) + 1;
  return {
    last_fetch_ok: false,
    last_fetch_error: args.reason.slice(0, 200),
    consecutive_unavailable_count: nextCount,
    unavailable_since: args.unavailableSince ?? args.nowIso,
    last_checked: args.nowIso,
    updated_at: args.nowIso,
  };
}

/** True only when we have a real new price — never alert on soft failures. */
export function maySendPriceAlert(fetched: { price?: number | null } | null | undefined): boolean {
  return Boolean(fetched?.price && fetched.price > 0);
}

export function shouldOpenScrappeyCircuit(
  consecutiveScrapeFailures: number,
  openAfter = DEFAULT_SCRAPPEY_CIRCUIT_OPEN_AFTER,
): boolean {
  return consecutiveScrapeFailures >= openAfter;
}
