import { describe, expect, it } from 'vitest';
import { reorderPickerCandidates, reorderSearchCandidateOffers } from '@/lib/match-status';
import type { SearchCandidateOffer } from '@/types/comparison';

describe('picker candidate order (0.9.103 regression)', () => {
  it('puts XM5 before XM6 for XM5 reference when confidence band is close', () => {
    const ref = 'Sony WH-1000XM5 беспроводные наушники';
    const ranked = [
      {
        offer: { title: 'Sony WH-1000XM6 беспроводные наушники Black', url: 'https://www.wildberries.ru/catalog/1437620571/detail.aspx' },
        confidence: 58,
        price: 17_238,
      },
      {
        offer: { title: 'Sony WH-1000XM5 беспроводные наушники синие', url: 'https://www.wildberries.ru/catalog/811830372/detail.aspx' },
        confidence: 57,
        price: 25_179,
      },
    ];

    const out = reorderPickerCandidates(
      ranked,
      ref,
      (r) => r.offer.title ?? '',
      (r) => r.confidence,
      (r) => r.price,
    );

    expect(out[0]!.offer.title).toMatch(/XM5/i);
    expect(out[1]!.offer.title).toMatch(/XM6/i);
  });

  it('puts H&S Menthol before Old Spice for Menthol reference', () => {
    const ref = 'Head & Shoulders шампунь от перхоти Ментол 0,6 л';
    const candidates: SearchCandidateOffer[] = [
      {
        title: 'Old Spice шампунь для мужчин 360 мл',
        url: 'https://market.yandex.ru/card/shampun-old-spice/4624539067',
        price: 431,
        matchConfidence: 55,
      },
      {
        title: 'Head & Shoulders шампунь Ментол 600 мл',
        url: 'https://market.yandex.ru/card/head-shoulders-menthol/123',
        price: 567,
        matchConfidence: 54,
      },
    ];

    const out = reorderSearchCandidateOffers(candidates, ref);
    expect(out[0]!.title).toMatch(/Ментол|Menthol/i);
    expect(out[1]!.title).toMatch(/Old Spice/i);
  });
});
