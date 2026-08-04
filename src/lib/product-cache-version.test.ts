import { describe, expect, it } from 'vitest';

/**
 * Documents product_cache unique (marketplace, product_id, cache_version):
 * v2 (full analysis) and v3 (web research) for the same SKU must not collide.
 */
describe('product_cache version coexistence', () => {
  it('treats cache_version as part of the identity key', () => {
    const key = (marketplace: string, productId: string, cacheVersion: number) =>
      `${marketplace}|${productId}|${cacheVersion}`;

    const v2 = key('wildberries', '123', 2);
    const v3 = key('wildberries', '123', 3);
    expect(v2).not.toBe(v3);

    const store = new Map<string, { analysis: string }>();
    store.set(v2, { analysis: 'full' });
    store.set(v3, { analysis: 'web' });
    expect(store.get(v2)?.analysis).toBe('full');
    expect(store.get(v3)?.analysis).toBe('web');
  });
});
