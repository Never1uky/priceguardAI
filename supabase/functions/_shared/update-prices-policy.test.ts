import { describe, expect, it } from 'vitest';
import {
  DEFAULT_UPDATE_PRICES_MAX_GROUPS,
  DEFAULT_UPDATE_PRICES_RUNTIME_BUDGET_MS,
  isUnavailablePriceResult,
  parsePositiveIntEnv,
  shouldStopByRuntimeBudget,
} from './update-prices-policy.ts';

describe('update-prices policy', () => {
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
});
