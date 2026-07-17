import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchWildberriesRoot, parseWildberriesRootFromDom } from '@/utils/parsers/wb-api';

describe('fetchWildberriesRoot (service worker safe)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('parseWildberriesRootFromDom returns null without document', () => {
    expect(parseWildberriesRootFromDom()).toBeNull();
  });

  it('fetchWildberriesRoot does not throw without document', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })),
    );

    await expect(fetchWildberriesRoot('453744250')).resolves.not.toThrow();
    const root = await fetchWildberriesRoot('453744250');
    expect(root === null || typeof root === 'string').toBe(true);
  });

  it('fetchWildberriesRoot returns null on network failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network');
      }),
    );

    await expect(fetchWildberriesRoot('453744250')).resolves.toBeNull();
  });
});
