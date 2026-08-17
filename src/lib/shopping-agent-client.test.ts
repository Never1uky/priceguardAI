import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/config', () => ({
  getSupabaseConfig: () => ({
    configured: true,
    url: 'https://example.supabase.co',
    anonKey: 'anon',
  }),
  functionsUrl: (name: string) => `https://example.supabase.co/functions/v1/${name}`,
}));

vi.mock('@/lib/supabase/edge-auth', () => ({
  getEdgeAuthHeaders: vi.fn(async () => ({
    'Content-Type': 'application/json',
    Authorization: 'Bearer test-jwt',
    apikey: 'anon',
  })),
}));

vi.mock('@/lib/supabase/auth', () => ({
  getAccessToken: vi.fn(async () => 'test-jwt'),
}));

import { getAccessToken } from '@/lib/supabase/auth';
import { EdgeError } from '@/lib/supabase/edge';
import {
  AGENT_POLL_INTERVAL_MS,
  AGENT_RUNNING_AT_MAP_KEY,
  AGENT_RUNNING_IDS_KEY,
  AGENT_RUNNING_KEY,
  AGENT_RUNNING_STALE_MS,
  __resetShoppingAgentClientForTests,
  getRunningAgentSearchIds,
  pollAgentSearch,
  submitAgentSearch,
} from '@/lib/shopping-agent-client';

const EDGE = 'https://example.supabase.co/functions/v1/shopping-agent';
const SEARCH_ID = '11111111-1111-4111-8111-111111111111';
const SEARCH_ID_B = '22222222-2222-4222-8222-222222222222';

const memory = new Map<string, unknown>();
const getPlatformInfo = vi.fn((cb?: () => void) => {
  cb?.();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function searchRow(over: Record<string, unknown> = {}) {
  return {
    id: SEARCH_ID,
    query: 'Google Pixel 8',
    status: 'searching',
    steps_taken: 1,
    cost_estimate_rub: 0.05,
    result: null,
    error: null,
    ...over,
  };
}

beforeEach(() => {
  memory.clear();
  getPlatformInfo.mockClear();
  vi.mocked(getAccessToken).mockResolvedValue('test-jwt');
  vi.stubGlobal('chrome', {
    runtime: { getPlatformInfo },
    storage: {
      local: {
        get: async (key: string | string[]) => {
          const keys = typeof key === 'string' ? [key] : key;
          const out: Record<string, unknown> = {};
          for (const k of keys) {
            if (memory.has(k)) out[k] = memory.get(k);
          }
          return out;
        },
        set: async (obj: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(obj)) memory.set(k, v);
        },
        remove: async (key: string | string[]) => {
          const keys = typeof key === 'string' ? [key] : key;
          for (const k of keys) memory.delete(k);
        },
      },
    },
  });
});

afterEach(() => {
  __resetShoppingAgentClientForTests();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('submitAgentSearch', () => {
  it('POSTs query and records running keys in the agent namespace', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true, searchId: SEARCH_ID }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(submitAgentSearch('  Google Pixel 8  ')).resolves.toEqual({ searchId: SEARCH_ID });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      EDGE,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ query: 'Google Pixel 8' }),
      }),
    );
    expect(memory.get(AGENT_RUNNING_KEY)).toBe(SEARCH_ID);
    expect(memory.get(AGENT_RUNNING_IDS_KEY)).toEqual([SEARCH_ID]);
    expect(memory.has(AGENT_RUNNING_AT_MAP_KEY)).toBe(true);
  });

  it('throws EdgeError with agent_daily_cap on 429', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(
          {
            ok: false,
            code: 'agent_daily_cap',
            error: 'Дневной лимит поисков агента исчерпан. Повторите завтра.',
          },
          429,
        ),
      ),
    );

    const err = await submitAgentSearch('пылесос до 15000').catch((e) => e);
    expect(err).toBeInstanceOf(EdgeError);
    expect(err).toMatchObject({ status: 429, code: 'agent_daily_cap' });
    expect(memory.get(AGENT_RUNNING_IDS_KEY)).toBeUndefined();
  });

  it('rejects empty query without fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(submitAgentSearch('   ')).rejects.toBeInstanceOf(EdgeError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('getRunningAgentSearchIds stale recovery', () => {
  it('prunes search ids older than AGENT_RUNNING_STALE_MS', async () => {
    const now = Date.now();
    memory.set(AGENT_RUNNING_IDS_KEY, [SEARCH_ID, SEARCH_ID_B]);
    memory.set(AGENT_RUNNING_KEY, SEARCH_ID);
    memory.set(AGENT_RUNNING_AT_MAP_KEY, {
      [SEARCH_ID]: now - AGENT_RUNNING_STALE_MS - 1_000,
      [SEARCH_ID_B]: now - 10_000,
    });

    await expect(getRunningAgentSearchIds()).resolves.toEqual([SEARCH_ID_B]);
    expect(memory.get(AGENT_RUNNING_IDS_KEY)).toEqual([SEARCH_ID_B]);
  });
});

describe('pollAgentSearch', () => {
  it('GETs on an interval shorter than compare-jobs and cleanup stops further ticks', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async (url: string) => {
      expect(String(url)).toBe(`${EDGE}/${SEARCH_ID}`);
      return jsonResponse({ ok: true, search: searchRow() });
    });
    vi.stubGlobal('fetch', fetchMock);

    const onUpdate = vi.fn();
    const stop = pollAgentSearch(SEARCH_ID, onUpdate);

    await vi.advanceTimersByTimeAsync(0);
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate.mock.calls[0]?.[0]).toMatchObject({ id: SEARCH_ID, status: 'searching' });

    await vi.advanceTimersByTimeAsync(AGENT_POLL_INTERVAL_MS);
    expect(onUpdate).toHaveBeenCalledTimes(2);

    stop();
    await vi.advanceTimersByTimeAsync(AGENT_POLL_INTERVAL_MS * 2);
    expect(onUpdate).toHaveBeenCalledTimes(2);
    expect(await getRunningAgentSearchIds()).toEqual([]);
  });

  it('stops polling when status is done', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ ok: true, search: searchRow({ status: 'evaluating' }) }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, search: searchRow({ status: 'done' }) }));
    vi.stubGlobal('fetch', fetchMock);

    const onUpdate = vi.fn();
    pollAgentSearch(SEARCH_ID, onUpdate);

    await vi.advanceTimersByTimeAsync(0);
    expect(onUpdate).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(AGENT_POLL_INTERVAL_MS);
    expect(onUpdate.mock.calls.at(-1)?.[0]).toMatchObject({ status: 'done' });

    await vi.advanceTimersByTimeAsync(AGENT_POLL_INTERVAL_MS * 2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('supersedes an earlier poll of the same searchId (generation)', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ ok: true, search: searchRow() })),
    );

    const first = vi.fn();
    const second = vi.fn();
    pollAgentSearch(SEARCH_ID, first);
    pollAgentSearch(SEARCH_ID, second);

    await vi.advanceTimersByTimeAsync(AGENT_POLL_INTERVAL_MS * 2);
    expect(second.mock.calls.length).toBeGreaterThan(0);
    const firstAfter = first.mock.calls.length;
    await vi.advanceTimersByTimeAsync(AGENT_POLL_INTERVAL_MS * 2);
    expect(first.mock.calls.length).toBe(firstAfter);
  });

  it('submitAgentSearch bumps epoch so an in-flight poll stops', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return jsonResponse({ ok: true, searchId: SEARCH_ID_B });
      }
      return jsonResponse({ ok: true, search: searchRow() });
    });
    vi.stubGlobal('fetch', fetchMock);

    const onUpdate = vi.fn();
    pollAgentSearch(SEARCH_ID, onUpdate);
    await vi.advanceTimersByTimeAsync(0);
    const callsAfterStart = onUpdate.mock.calls.length;

    await submitAgentSearch('наушники');
    await vi.advanceTimersByTimeAsync(AGENT_POLL_INTERVAL_MS * 2);
    expect(onUpdate.mock.calls.length).toBe(callsAfterStart);
  });

  it('keepalive pings getPlatformInfo while a poll is active', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ ok: true, search: searchRow() })),
    );

    const stop = pollAgentSearch(SEARCH_ID, vi.fn());
    await vi.advanceTimersByTimeAsync(20_000);
    expect(getPlatformInfo).toHaveBeenCalled();
    stop();
  });
});
