import { describe, expect, it } from 'vitest';

/** Mirrors supabase/functions/_shared/marketplace-search-core resolveCompareResearchTargets. */
const VALID = [
  'wildberries',
  'ozon',
  'yandex_market',
  'megamarket',
  'aliexpress',
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
  it('fallback is other VALID MPs (trio + megamarket + aliexpress)', () => {
    expect(resolveTargets('wildberries', undefined).sort()).toEqual(
      ['aliexpress', 'megamarket', 'ozon', 'yandex_market'].sort(),
    );
    expect(resolveTargets('ozon', []).sort()).toEqual(
      ['aliexpress', 'megamarket', 'wildberries', 'yandex_market'].sort(),
    );
  });

  it('intersects with selected — megamarket + aliexpress when selected', () => {
    expect(resolveTargets('wildberries', ['ozon', 'megamarket', 'aliexpress', 'dns'])).toEqual([
      'ozon',
      'megamarket',
      'aliexpress',
    ]);
  });

  it('empty intersection when only source selected', () => {
    expect(resolveTargets('wildberries', ['wildberries'])).toEqual([]);
  });

  it('source megamarket can research core trio + ali', () => {
    expect(resolveTargets('megamarket', ['wildberries', 'ozon', 'aliexpress']).sort()).toEqual([
      'aliexpress',
      'ozon',
      'wildberries',
    ]);
  });

  it('source aliexpress can research core trio + mega', () => {
    expect(
      resolveTargets('aliexpress', ['wildberries', 'ozon', 'megamarket']).sort(),
    ).toEqual(['megamarket', 'ozon', 'wildberries']);
  });
});
