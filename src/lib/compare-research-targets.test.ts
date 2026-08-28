import { describe, expect, it } from 'vitest';

/** Mirrors supabase/functions/_shared/marketplace-search-core resolveCompareResearchTargets. */
const VALID = [
  'wildberries',
  'ozon',
  'yandex_market',
  'megamarket',
  'aliexpress',
  'mvideo',
] as const;

function resolveTargets(
  sourceMarketplace: (typeof VALID)[number],
  requested: unknown,
): string[] {
  const base = VALID.filter((m) => m !== sourceMarketplace);
  if (!Array.isArray(requested) || requested.length === 0) {
    return [...base];
  }
  const want = new Set(
    requested.filter((x): x is string => typeof x === 'string').map((x) => x.trim()),
  );
  return base.filter((m) => want.has(m));
}

describe('compare-research target resolution', () => {
  it('fallback is other VALID MPs (trio + megamarket + aliexpress + mvideo)', () => {
    expect(resolveTargets('wildberries', undefined).sort()).toEqual(
      ['aliexpress', 'megamarket', 'mvideo', 'ozon', 'yandex_market'].sort(),
    );
    expect(resolveTargets('ozon', []).sort()).toEqual(
      ['aliexpress', 'megamarket', 'mvideo', 'wildberries', 'yandex_market'].sort(),
    );
  });

  it('intersects with selected — megamarket + aliexpress + mvideo when selected', () => {
    expect(
      resolveTargets('wildberries', ['ozon', 'megamarket', 'aliexpress', 'mvideo', 'dns']),
    ).toEqual(['ozon', 'megamarket', 'aliexpress', 'mvideo']);
  });

  it('empty intersection when only source selected', () => {
    expect(resolveTargets('wildberries', ['wildberries'])).toEqual([]);
  });

  it('source megamarket can research core trio + ali + mvideo', () => {
    expect(
      resolveTargets('megamarket', ['wildberries', 'ozon', 'aliexpress', 'mvideo']).sort(),
    ).toEqual(['aliexpress', 'mvideo', 'ozon', 'wildberries']);
  });

  it('source aliexpress can research core trio + mega + mvideo', () => {
    expect(
      resolveTargets('aliexpress', ['wildberries', 'ozon', 'megamarket', 'mvideo']).sort(),
    ).toEqual(['megamarket', 'mvideo', 'ozon', 'wildberries']);
  });

  it('source mvideo can research core trio + mega + ali', () => {
    expect(
      resolveTargets('mvideo', ['wildberries', 'ozon', 'megamarket', 'aliexpress']).sort(),
    ).toEqual(['aliexpress', 'megamarket', 'ozon', 'wildberries']);
  });
});
