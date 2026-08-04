import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearPendingSyncForTests,
  enqueuePendingSync,
  flushPendingSync,
  peekPendingSync,
  registerPendingSyncHandler,
} from '@/lib/pending-sync';

const memory = new Map<string, unknown>();

vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: async (key: string | string[] | Record<string, unknown>) => {
        const keys = typeof key === 'string' ? [key] : Array.isArray(key) ? key : Object.keys(key);
        const out: Record<string, unknown> = {};
        for (const k of keys) {
          if (memory.has(k)) out[k] = memory.get(k);
        }
        return out;
      },
      set: async (obj: Record<string, unknown>) => {
        for (const [k, v] of Object.entries(obj)) memory.set(k, v);
      },
    },
  },
  alarms: {
    create: async () => undefined,
  },
});

describe('PendingSync outbox', () => {
  beforeEach(async () => {
    memory.clear();
    await clearPendingSyncForTests();
  });

  it('dedupes by dedupeKey (last-write-wins)', async () => {
    await enqueuePendingSync('price_cache_put', 'price_cache:wb:1', { v: 1 });
    await enqueuePendingSync('price_cache_put', 'price_cache:wb:1', { v: 2 });
    const list = await peekPendingSync();
    expect(list).toHaveLength(1);
    expect((list[0].payload as { v: number }).v).toBe(2);
  });

  it('flush success dequeues', async () => {
    registerPendingSyncHandler('price_cache_put', async () => 'ok');
    await enqueuePendingSync('price_cache_put', 'price_cache:wb:2', { ok: true });
    const result = await flushPendingSync({ maxItems: 5 });
    expect(result.ok).toBe(1);
    expect(await peekPendingSync()).toHaveLength(0);
  });

  it('flush retry schedules nextAttemptAt', async () => {
    registerPendingSyncHandler('compare_sync', async () => 'retry');
    await enqueuePendingSync('compare_sync', 'compare_sync:full', { products: [] });
    const result = await flushPendingSync({ maxItems: 5, now: Date.now() });
    expect(result.retry).toBe(1);
    const list = await peekPendingSync();
    expect(list).toHaveLength(1);
    expect(list[0].attempts).toBe(1);
    expect(list[0].nextAttemptAt).toBeGreaterThan(Date.now());
  });
});
