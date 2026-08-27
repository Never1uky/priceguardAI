import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchViaScrappey } from './scrappey.ts';

describe('fetchViaScrappey', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns html from successful request mode', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            data: 'success',
            solution: {
              statusCode: 200,
              response:
                '<html><body>ok content here with enough length for scrappey validation threshold padding</body></html>',
            },
          }),
          { status: 200 },
        ),
      ),
    );

    const result = await fetchViaScrappey('https://example.com/p', { apiKey: 'test-key' });
    expect(result.html).toContain('ok content');
    expect(result.mode).toBe('request');
    expect(result.error).toBeUndefined();
  });

  it('falls back to browser when request mode is blocked', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: 'success',
            solution: { statusCode: 200, response: '<html>showcaptcha</html>' },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: 'success',
            solution: {
              statusCode: 200,
              response:
                '<html><body>real product page with enough content for validation and price data block</body></html>',
            },
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchViaScrappey('https://www.ozon.ru/product/x/', { apiKey: 'k' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.mode).toBe('browser');
    expect(result.html).toContain('real product');
  });

  it('does not fall back to browser on request timeout', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      (_url: string, init?: { signal?: AbortSignal }) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const pending = fetchViaScrappey('https://example.com/p', { apiKey: 'k' }, {
      timeoutMs: 5,
    });
    await vi.advanceTimersByTimeAsync(10);
    const result = await pending;
    expect(result.error).toBe('timeout');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('does not fall back to browser on HTTP 502 from Scrappey', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ data: 'error', error: 'upstream_502', solution: { statusCode: 502 } }),
        { status: 502 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchViaScrappey('https://example.com/p', { apiKey: 'k' });
    expect(result.html).toBeNull();
    expect(result.status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
