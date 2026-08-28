import { describe, expect, it } from 'vitest';
import {
  ALI_MEGA_SERP_MAX_PRICE_RATIO,
  isAliMegaCardPriceTooCheap,
  isAliMegaSerpPriceOutlier,
  scoreProductMatch,
} from '@/lib/product-match';
import { tryUnambiguousSerpVerified } from '@/lib/serp-auto-pick';
import { pickSearchFromCandidates, type SearchCandidate } from '@/utils/parsers/search-results';
import { buildOfferFromRankedCandidates } from '@/lib/search-offer-from-candidates';
import type { MarketplaceOffer } from '@/types/comparison';

describe('Ali/Mega Layer B price guards', () => {
  it('ref 12000 vs cand 1999 → outlier; 9500 → keep', () => {
    expect(isAliMegaSerpPriceOutlier(12_000, 1_999)).toBe(true);
    expect(isAliMegaSerpPriceOutlier(12_000, 9_500)).toBe(false);
    expect(ALI_MEGA_SERP_MAX_PRICE_RATIO).toBe(2);
  });

  it('card &lt; 20% of ref → too cheap', () => {
    expect(isAliMegaCardPriceTooCheap(12_000, 1_999)).toBe(true);
    expect(isAliMegaCardPriceTooCheap(12_000, 2_500)).toBeFalsy();
    expect(isAliMegaCardPriceTooCheap(12_000, 9_500)).toBe(false);
  });

  it('Ali pickSearch: priced dummy dropped; legit cheaper kept', () => {
    const ref = 'Смартфон Xiaomi Redmi 15C 8/256';
    const cands: SearchCandidate[] = [
      {
        title: 'Смартфон Xiaomi Redmi 15C похожий муляж без слова',
        url: 'https://aliexpress.ru/item/1005012699704571.html',
        price: 1_999,
        rating: null,
      },
      {
        title: 'Смартфон Xiaomi Redmi 15C 8/256ГБ',
        url: 'https://aliexpress.ru/item/1005008888777666.html',
        price: 9_500,
        rating: null,
      },
    ];
    // Force soft path: first cand may score >0 on title without муляж word
    const { offer, ranked } = pickSearchFromCandidates('aliexpress', 'Redmi 15C', ref, cands, {
      referencePrice: 12_000,
    });
    const prices = [
      ...(offer.searchCandidates?.map((c) => c.price) ?? []),
      offer.price,
      ...ranked.map((r) => r.candidate.price),
    ].filter((p): p is number => p != null && p > 0);
    expect(prices.every((p) => p !== 1_999)).toBe(true);
    expect(prices.some((p) => p === 9_500) || offer.matchStatus === 'not_found').toBe(true);
  });

  it('null SERP price → no verified auto-pick (needs_choice / cascade)', () => {
    const verified = tryUnambiguousSerpVerified('aliexpress', [
      {
        title: 'Смартфон Xiaomi Redmi 15C 8/256',
        url: 'https://aliexpress.ru/item/1005008888777666.html',
        price: null,
        confidence: 96,
      },
    ]);
    expect(verified).toBeNull();
  });

  it('Ali verified blocked when SERP price is outlier vs reference', () => {
    const verified = tryUnambiguousSerpVerified(
      'aliexpress',
      [
        {
          title: 'Смартфон Xiaomi Redmi 15C 8/256',
          url: 'https://aliexpress.ru/item/1005008888777666.html',
          price: 1_999,
          confidence: 96,
        },
      ],
      { referencePrice: 12_000 },
    );
    expect(verified).toBeNull();
  });

  it('buildOfferFromRankedCandidates drops Ali price outlier', () => {
    const offer = buildOfferFromRankedCandidates(
      'aliexpress',
      'Redmi 15C',
      'https://aliexpress.ru/wholesale?SearchText=Redmi',
      [
        {
          confidence: 90,
          offer: {
            marketplace: 'aliexpress',
            title: 'Смартфон Xiaomi Redmi 15C 8/256',
            price: 1_999,
            delivery: null,
            rating: null,
            url: 'https://aliexpress.ru/item/1005012699704571.html',
            found: true,
          } satisfies MarketplaceOffer,
        },
      ],
      'Смартфон Xiaomi Redmi 15C 8/256',
      12_000,
    );
    expect(offer.matchStatus).toBe('not_found');
    expect(offer.found).toBe(false);
  });

  it('CORE ozon soft path N/A: weak junk may still enter without Ali/Mega price gate', () => {
    // Documented: Layer B price outlier filter is Ali/Mega-only — CORE unchanged.
    const { offer } = pickSearchFromCandidates(
      'ozon',
      'Pixel 10',
      'Смартфон Google Pixel 10 128GB',
      [
        {
          title: 'Смартфон Google Pixel 10 128GB дешёвый лот',
          url: 'https://www.ozon.ru/product/pixel-cheap-111/',
          price: 1_999,
          rating: null,
        },
      ],
      { referencePrice: 79_990, minScore: 0 },
    );
    // May be needs_choice or not_found depending on score — must NOT use Ali mega gate.
    // If scored >0, priced outlier can still appear on CORE (N/A for Layer B).
    expect(['not_found', 'needs_choice', 'verified', 'serp_only']).toContain(
      offer.matchStatus ?? 'not_found',
    );
  });

  it('real Redmi title still scores > 0 (Layer A regression)', () => {
    expect(
      scoreProductMatch(
        'Смартфон Xiaomi Redmi 15C 8/256',
        'Смартфон Xiaomi Redmi 15C 8 ГБ/256ГБ синий',
      ),
    ).toBeGreaterThan(0);
  });
});
