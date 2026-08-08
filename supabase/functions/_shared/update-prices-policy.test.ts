import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SKU_FETCH_TIMEOUT_MS,
  DEFAULT_UPDATE_PRICES_MAX_GROUPS,
  DEFAULT_UPDATE_PRICES_RUNTIME_BUDGET_MS,
  UPDATE_PRICES_ALREADY_RUNNING_NOTE,
  UNAVAILABLE_BACKOFF_MAX_MS,
  decideUpdatePricesLock,
  effectivePriceFreshMs,
  isPriceRowStale,
  isTimeoutError,
  isUnavailablePriceResult,
  parsePositiveIntEnv,
  raceWithTimeout,
  shouldStopByRuntimeBudget,
  unavailableFreshMsMultiplier,
} from './update-prices-policy.ts';

describe('update-prices policy', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('parses positive integer env with fallback', () => {
    expect(parsePositiveIntEnv('200', 10)).toBe(200);
    expect(parsePositiveIntEnv(undefined, 10)).toBe(10);
    expect(parsePositiveIntEnv('0', 10)).toBe(10);
    expect(parsePositiveIntEnv('nan', 10)).toBe(10);
  });

  it('stops only after runtime budget', () => {
    const started = 1_000_000;
    expect(
      shouldStopByRuntimeBudget(started, DEFAULT_UPDATE_PRICES_RUNTIME_BUDGET_MS, started + 1000),
    ).toBe(false);
    expect(
      shouldStopByRuntimeBudget(
        started,
        DEFAULT_UPDATE_PRICES_RUNTIME_BUDGET_MS,
        started + DEFAULT_UPDATE_PRICES_RUNTIME_BUDGET_MS,
      ),
    ).toBe(true);
  });

  it('classifies unavailable results (OOS/no price)', () => {
    expect(isUnavailablePriceResult(null)).toBe(true);
    expect(isUnavailablePriceResult(undefined)).toBe(true);
    expect(isUnavailablePriceResult({})).toBe(true);
    expect(isUnavailablePriceResult({ price: 0 })).toBe(true);
    expect(isUnavailablePriceResult({ price: -1 })).toBe(true);
    expect(isUnavailablePriceResult({ price: 1 })).toBe(false);
  });

  it('keeps sane default max groups', () => {
    expect(DEFAULT_UPDATE_PRICES_MAX_GROUPS).toBeGreaterThan(0);
  });

  it('scales OOS fresh interval by consecutive failures', () => {
    expect(unavailableFreshMsMultiplier(0)).toBe(1);
    expect(unavailableFreshMsMultiplier(1)).toBe(1);
    expect(unavailableFreshMsMultiplier(2)).toBe(4);
    expect(unavailableFreshMsMultiplier(3)).toBe(4);
    expect(unavailableFreshMsMultiplier(4)).toBe(12);
    expect(unavailableFreshMsMultiplier(99)).toBe(12);

    const base = 6 * 60 * 60 * 1000;
    expect(effectivePriceFreshMs(base, 1)).toBe(base);
    expect(effectivePriceFreshMs(base, 2)).toBe(base * 4);
    expect(effectivePriceFreshMs(base, 4)).toBe(base * 12);
    expect(effectivePriceFreshMs(base, 50)).toBe(UNAVAILABLE_BACKOFF_MAX_MS);
  });

  it('detects stale rows with OOS backoff', () => {
    const nowMs = Date.parse('2026-08-05T12:00:00.000Z');
    const base = 3 * 60 * 60 * 1000;
    const checked1hAgo = new Date(nowMs - 60 * 60 * 1000).toISOString();
    const checked5hAgo = new Date(nowMs - 5 * 60 * 60 * 1000).toISOString();

    expect(
      isPriceRowStale({
        lastChecked: null,
        nowMs,
        baseFreshMs: base,
        consecutiveUnavailableCount: 0,
      }),
    ).toBe(true);

    expect(
      isPriceRowStale({
        lastChecked: checked1hAgo,
        nowMs,
        baseFreshMs: base,
        consecutiveUnavailableCount: 0,
      }),
    ).toBe(false);

    expect(
      isPriceRowStale({
        lastChecked: checked5hAgo,
        nowMs,
        baseFreshMs: base,
        consecutiveUnavailableCount: 1,
      }),
    ).toBe(true);

    // 2 failures → x4 (12h); 5h old is still fresh
    expect(
      isPriceRowStale({
        lastChecked: checked5hAgo,
        nowMs,
        baseFreshMs: base,
        consecutiveUnavailableCount: 2,
      }),
    ).toBe(false);
  });

  it('exports already-running note for lock skip', () => {
    expect(UPDATE_PRICES_ALREADY_RUNNING_NOTE).toBe('already running');
  });

  describe('decideUpdatePricesLock (duplicate pg_cron / GitHub Actions run protection)', () => {
    it('lock acquired → proceed_with_lock (this run does the work)', () => {
      expect(decideUpdatePricesLock(true, null)).toEqual({ action: 'proceed_with_lock' });
    });

    it('lock NOT acquired (another run holds it) → skip with the already-running note', () => {
      expect(decideUpdatePricesLock(false, null)).toEqual({
        action: 'skip',
        note: UPDATE_PRICES_ALREADY_RUNNING_NOTE,
      });
    });

    it('RPC error → proceed_without_lock (fail open, never silently stop checking prices)', () => {
      expect(decideUpdatePricesLock(null, new Error('rpc down'))).toEqual({
        action: 'proceed_without_lock',
      });
    });

    it('error takes precedence even if lockAcquired happens to be true', () => {
      // Defensive: an inconsistent RPC response (data + error both set) must not
      // be trusted as "lock held" — treat as unlocked/best-effort instead.
      expect(decideUpdatePricesLock(true, new Error('rpc down'))).toEqual({
        action: 'proceed_without_lock',
      });
    });

    it('unexpected shape (no data, no error) → proceed_without_lock, never blocks the run', () => {
      expect(decideUpdatePricesLock(undefined, null)).toEqual({ action: 'proceed_without_lock' });
      expect(decideUpdatePricesLock(null, null)).toEqual({ action: 'proceed_without_lock' });
    });
  });

  it('raceWithTimeout resolves before deadline', async () => {
    await expect(raceWithTimeout(Promise.resolve(42), 50)).resolves.toBe(42);
  });

  it('raceWithTimeout rejects with TimeoutError', async () => {
    vi.useFakeTimers();
    const pending = raceWithTimeout(
      new Promise(() => {
        /* never */
      }),
      25,
    );
    const assertion = expect(pending).rejects.toMatchObject({
      name: 'TimeoutError',
      message: 'timeout',
    });
    await vi.advanceTimersByTimeAsync(25);
    await assertion;
    expect(isTimeoutError({ name: 'TimeoutError', message: 'timeout' })).toBe(true);
    expect(DEFAULT_SKU_FETCH_TIMEOUT_MS).toBe(22_000);
  });
});
