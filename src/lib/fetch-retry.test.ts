import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  classifyFetchError,
  classifyHttpStatus,
  fetchWithRetry,
  safeFetch,
} from '@/lib/fetch-retry';

describe('classifyHttpStatus', () => {
  it('marks 5xx and 429 retryable', () => {
    expect(classifyHttpStatus(502).kind).toBe('http5xx');
    expect(classifyHttpStatus(502).retryable).toBe(true);
    expect(classifyHttpStatus(429).retryable).toBe(true);
    expect(classifyHttpStatus(400).retryable).toBe(false);
    expect(classifyHttpStatus(400).kind).toBe('http4xx');
  });

  it('userMessage never says HTTP 502', () => {
    expect(classifyHttpStatus(502).userMessage).not.toMatch(/502/);
    expect(classifyHttpStatus(502).userMessage.toLowerCase()).toMatch(/сервер|недоступен/);
  });
});

describe('classifyFetchError', () => {
  it('maps AbortError to timeout', () => {
    const err = new DOMException('Aborted', 'AbortError');
    expect(classifyFetchError(err).kind).toBe('timeout');
  });
});

describe('safeFetch', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns ok on 200', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"ok":true}', { status: 200 })),
    );
    const result = await safeFetch('https://example.com', undefined, {
      retries: 0,
      timeoutMs: 5_000,
    });
    expect(result.ok).toBe(true);
  });

  it('retries 502 then succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('bad', { status: 502 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await safeFetch('https://example.com/edge', undefined, {
      retries: 2,
      delayMs: 1,
      jitter: false,
      timeoutMs: 5_000,
    });
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry 400', async () => {
    const fetchMock = vi.fn(async () => new Response('no', { status: 400 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await safeFetch('https://example.com', undefined, {
      retries: 3,
      delayMs: 1,
      jitter: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('http4xx');
      expect(result.error.status).toBe(400);
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not retry 429 on marketplace search APIs', async () => {
    const fetchMock = vi.fn(async () => new Response('no', { status: 429 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await safeFetch(
      'https://search.wb.ru/exactmatch/ru/common/v5/search?query=pixel',
      undefined,
      { retries: 3, delayMs: 1, jitter: false },
    );
    expect(result.ok).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('still retries 429 on non-search URLs', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('no', { status: 429 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await safeFetch('https://example.com/card', undefined, {
      retries: 2,
      delayMs: 1,
      jitter: false,
      timeoutMs: 5_000,
    });
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('fetchWithRetry', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns Response for HTTP error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x', { status: 403 })));
    const res = await fetchWithRetry('https://example.com', undefined, {
      retries: 0,
      timeoutMs: 5_000,
    });
    expect(res.status).toBe(403);
  });
});
