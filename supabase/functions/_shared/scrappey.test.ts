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

  it('returns missing_credentials without api key', async () => {
    const result = await fetchViaScrappey('https://example.com', { apiKey: '' });
    expect(result.error).toBe('missing_credentials');
  });
});
