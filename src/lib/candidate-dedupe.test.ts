import { describe, expect, it } from 'vitest';
import {
  candidateDedupeKey,
  dedupeByCandidateIdentity,
} from '@/lib/candidate-dedupe';
import { buildOfferFromRankedCandidates } from '@/lib/search-offer-from-candidates';
import { finalizeResearchOffer } from '@/lib/compare-offers';
import { formatOfferErrorForDisplay } from '@/lib/offer-error-display';
import { pickSearchFromCandidates, type SearchCandidate } from '@/utils/parsers/search-results';
import { collectSerpCascadeCandidates } from '@/lib/card-cascade-verify';
import type { MarketplaceOffer } from '@/types/comparison';

describe('candidateDedupeKey', () => {
  it('collapses YM slug variants to same product id', () => {
    const a = candidateDedupeKey(
      'yandex_market',
      'https://market.yandex.ru/product--redmi-note-a/123456789?sku=1',
    );
    const b = candidateDedupeKey(
      'yandex_market',
      'https://market.yandex.ru/product--redmi-note-b/123456789?sku=2',
    );
    expect(a).toBe('yandex_market:123456789');
    expect(b).toBe(a);
  });

  it('collapses Ali query variants to same item id', () => {
    const a = candidateDedupeKey(
      'aliexpress',
      'https://aliexpress.ru/item/1005006123456789.html?spm=x',
    );
    const b = candidateDedupeKey(
      'aliexpress',
      'https://www.aliexpress.ru/item/1005006123456789.html',
    );
    expect(a).toBe('aliexpress:1005006123456789');
    expect(b).toBe(a);
  });
});

describe('YM duplicate SERP → auto-pick (not triple needs_choice)', () => {
  const searchUrl = 'https://market.yandex.ru/search?text=pixel';
  const ref = 'Смартфон Google Pixel 10 128GB';

  function ymRanked(slug: string, confidence: number) {
    return {
      confidence,
      offer: {
        marketplace: 'yandex_market' as const,
        title: ref,
        price: 12_156,
        delivery: null,
        rating: 5,
        url: `https://market.yandex.ru/product--${slug}/987654321`,
        found: true,
      } satisfies MarketplaceOffer,
    };
  }

  it('buildOfferFromRankedCandidates: 3 same product id → 1 candidate + auto-pick', () => {
    const result = buildOfferFromRankedCandidates('yandex_market', ref, searchUrl, [
      ymRanked('pixel-indigo', 96),
      ymRanked('pixel-indigo-2', 95),
      ymRanked('pixel-copy', 94),
    ]);

    expect(result.searchCandidates?.length ?? 0).toBeLessThanOrEqual(1);
    expect(result.needsManualPick).toBeFalsy();
    expect(result.found).toBe(true);
    expect(result.url).toContain('987654321');
    expect(result.matchStatus).not.toBe('needs_choice');
  });

  it('pickSearchFromCandidates: duplicate YM urls → single unique', () => {
    const cands: SearchCandidate[] = [
      {
        title: ref,
        url: 'https://market.yandex.ru/product--a/987654321',
        price: 12_156,
        rating: 5,
      },
      {
        title: ref,
        url: 'https://market.yandex.ru/product--b/987654321?sku=9',
        price: 12_156,
        rating: 5,
      },
      {
        title: ref,
        url: 'https://market.yandex.ru/product--c/987654321',
        price: 12_156,
        rating: 5,
      },
    ];
    const { offer } = pickSearchFromCandidates('yandex_market', ref, ref, cands, {
      referencePrice: 12_200,
    });
    expect(offer.searchCandidates?.length ?? (offer.found ? 1 : 0)).toBeLessThanOrEqual(1);
    if (offer.needsManualPick) {
      expect(offer.searchCandidates).toHaveLength(1);
    } else {
      expect(offer.found).toBe(true);
    }
  });

  it('collectSerpCascadeCandidates dedupes YM slug twins', () => {
    const list = collectSerpCascadeCandidates({
      marketplace: 'yandex_market',
      title: ref,
      price: null,
      delivery: null,
      rating: null,
      url: searchUrl,
      found: false,
      needsManualPick: true,
      matchStatus: 'needs_choice',
      searchCandidates: [
        {
          title: ref,
          url: 'https://market.yandex.ru/product--a/111222333',
          price: 10_000,
          matchConfidence: 92,
          priority: 100,
        },
        {
          title: ref,
          url: 'https://market.yandex.ru/product--b/111222333',
          price: 10_000,
          matchConfidence: 90,
          priority: 90,
        },
        {
          title: ref,
          url: 'https://market.yandex.ru/product--c/111222333',
          price: 10_000,
          matchConfidence: 88,
          priority: 80,
        },
      ],
    });
    expect(list).toHaveLength(1);
  });
});

describe('Ali not_found copy + needs_choice finalize', () => {
  it('formatOfferErrorForDisplay does not promise similar picker', () => {
    const formatted = formatOfferErrorForDisplay(
      'Подходящий товар не найден в выдаче (запрос: «Pixel 10»)',
    );
    expect(formatted.text).not.toMatch(/похожие вариант/i);
    expect(formatted.kind).toBe('no_confident_match');
  });

  it('finalizeResearchOffer keeps Ali needs_choice with candidates', () => {
    const offer: MarketplaceOffer = {
      marketplace: 'aliexpress',
      title: 'Pixel 10',
      price: null,
      delivery: null,
      rating: null,
      url: 'https://aliexpress.ru/wholesale?SearchText=pixel',
      found: false,
      needsManualPick: true,
      matchStatus: 'needs_choice',
      searchCandidates: [
        {
          title: 'Google Pixel 10 128GB',
          url: 'https://aliexpress.ru/item/1005009998887776.html',
          price: 78_500,
          matchConfidence: 88,
          priority: 100,
        },
        {
          title: 'Google Pixel 10 256GB',
          url: 'https://aliexpress.ru/item/1005009998887777.html',
          price: 85_000,
          matchConfidence: 84,
          priority: 90,
        },
      ],
      error: 'Есть 2 похожих варианта — проверяем карточки',
    };
    const finalized = finalizeResearchOffer(offer);
    expect(finalized.matchStatus).toBe('needs_choice');
    expect(finalized.needsManualPick).toBe(true);
    expect(finalized.searchCandidates).toHaveLength(2);
  });

  it('Ali junk-only SERP → not_found without similar-variants tease', () => {
    const { offer } = pickSearchFromCandidates(
      'aliexpress',
      'Google Pixel 10 128GB',
      'Смартфон Google Pixel 10 128GB',
      [
        {
          title: 'Комод Вега',
          url: 'https://aliexpress.ru/item/1005006000237015.html',
          price: 12_990,
          rating: null,
        },
      ],
      { referencePrice: 79_990 },
    );
    expect(offer.matchStatus).toBe('not_found');
    expect(offer.needsManualPick).toBeFalsy();
    expect(offer.searchCandidates?.length ?? 0).toBe(0);
    expect(offer.error ?? '').not.toMatch(/Проверьте похожие варианты/i);
  });
});

describe('dedupeByCandidateIdentity keeps higher score', () => {
  it('prefers higher confidence twin', () => {
    const out = dedupeByCandidateIdentity(
      'ozon',
      [
        { url: 'https://www.ozon.ru/product/foo-111/', score: 80 },
        { url: 'https://www.ozon.ru/product/foo-111/?x=1', score: 95 },
      ],
      (x) => x.url,
      (x) => x.score,
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.score).toBe(95);
  });
});
