import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCRAPPEY_CIRCUIT_OPEN_AFTER,
  SCRAPE_FAIL_REASON,
  classifyFetchFailure,
  maySendPriceAlert,
  shouldOpenScrappeyCircuit,
  softFailureTrackedPatch,
} from './update-prices-failure.ts';

describe('update-prices failure policy', () => {
  it('classifies timeout as soft', () => {
    expect(classifyFetchFailure({ timedOut: true })).toEqual({
      kind: 'timeout',
      reason: 'timeout',
      soft: true,
    });
  });

  it('classifies null fetch as soft scrape_failed (no false alert path)', () => {
    expect(classifyFetchFailure({ fetchedNull: true })).toMatchObject({
      soft: true,
      reason: SCRAPE_FAIL_REASON,
    });
  });

  it('softFailureTrackedPatch bumps counter and sets last_checked cooldown', () => {
    const patch = softFailureTrackedPatch({
      nowIso: '2026-08-25T12:00:00.000Z',
      consecutiveUnavailableCount: 1,
      unavailableSince: null,
      reason: 'timeout',
    });
    expect(patch).toMatchObject({
      last_fetch_ok: false,
      last_fetch_error: 'timeout',
      consecutive_unavailable_count: 2,
      last_checked: '2026-08-25T12:00:00.000Z',
    });
    expect(patch).not.toHaveProperty('last_price');
  });

  it('maySendPriceAlert only on positive price', () => {
    expect(maySendPriceAlert(null)).toBe(false);
    expect(maySendPriceAlert({ price: 0 })).toBe(false);
    expect(maySendPriceAlert({ price: 100 })).toBe(true);
  });

  it('opens scrappey circuit after threshold', () => {
    expect(shouldOpenScrappeyCircuit(7)).toBe(false);
    expect(shouldOpenScrappeyCircuit(8)).toBe(true);
    expect(DEFAULT_SCRAPPEY_CIRCUIT_OPEN_AFTER).toBe(8);
  });
});
