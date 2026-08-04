import { describe, expect, it } from 'vitest';
import {
  addRunningId,
  keepAliveShouldStart,
  keepAliveShouldStop,
  normalizeRunningAtMap,
  normalizeRunningIds,
  pruneStaleRunning,
  removeRunningId,
} from '@/lib/compare-running-state';

describe('compare-running-state', () => {
  it('normalizeRunningIds accepts string, array, and ignores junk', () => {
    expect(normalizeRunningIds('a')).toEqual(['a']);
    expect(normalizeRunningIds(['a', 'b', 'a', '', 1 as unknown as string])).toEqual(['a', 'b']);
    expect(normalizeRunningIds(null)).toEqual([]);
  });

  it('addRunningId does not wipe sibling ids', () => {
    const first = addRunningId([], {}, 'A', 100);
    const second = addRunningId(first.ids, first.startedAt, 'B', 200);
    expect(second.ids).toEqual(['A', 'B']);
    expect(second.startedAt).toEqual({ A: 100, B: 200 });
  });

  it('removeRunningId A leaves B', () => {
    let s = addRunningId([], {}, 'A', 100);
    s = addRunningId(s.ids, s.startedAt, 'B', 200);
    const next = removeRunningId(s.ids, s.startedAt, 'A');
    expect(next.ids).toEqual(['B']);
    expect(next.startedAt).toEqual({ B: 200 });
  });

  it('pruneStaleRunning removes only stale entries', () => {
    const now = 10_000 + 5 * 60_000;
    const ids = ['fresh', 'stale'];
    const startedAt = { fresh: now - 60_000, stale: 1_000 };
    const pruned = pruneStaleRunning(ids, startedAt, now, 4 * 60_000);
    expect(pruned.ids).toEqual(['fresh']);
    expect(pruned.pruned).toEqual(['stale']);
    expect(pruned.startedAt).toEqual({ fresh: now - 60_000 });
  });

  it('normalizeRunningAtMap backfills missing timestamps', () => {
    expect(normalizeRunningAtMap(undefined, ['a'], 50)).toEqual({ a: 50 });
    expect(normalizeRunningAtMap(99, ['a'], 50)).toEqual({ a: 99 });
    expect(normalizeRunningAtMap({ a: 10, b: 20 }, ['a'], 50)).toEqual({ a: 10 });
  });

  it('keepAlive refcount start/stop', () => {
    expect(keepAliveShouldStart(1)).toBe(true);
    expect(keepAliveShouldStart(2)).toBe(false);
    expect(keepAliveShouldStop(0)).toBe(true);
    expect(keepAliveShouldStop(1)).toBe(false);
  });
});
