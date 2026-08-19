/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from 'vitest';
import {
  parseWildberriesSerpHtml,
  pickSearchFromCandidates,
  pickWbDisplayPrice,
} from '@/utils/parsers/search-results';
import {
  hasLargePriceSpreadAmongClose,
  pickCheapestAmongCloseMatches,
} from '@/lib/match-status';
import { buildWbImageUrl } from '@/utils/wb-image';

describe('pickWbDisplayPrice', () => {
  it('prefers min sale price over crossed-out max', () => {
    expect(pickWbDisplayPrice([33_023, 26_018], 34_000)).toBe(26_018);
    expect(pickWbDisplayPrice([26_018, 33_023])).toBe(26_018);
  });
});

describe('pickCheapestAmongCloseMatches', () => {
  it('reorders close matches by price ascending', () => {
    const ranked = [
      { confidence: 80, price: 33_023, id: 'expensive' },
      { confidence: 78, price: 26_018, id: 'cheap' },
      { confidence: 60, price: 20_000, id: 'weak' },
    ];
    const out = pickCheapestAmongCloseMatches(ranked, 5);
    expect(out[0]?.id).toBe('cheap');
  });

  it('with delta 12, Pixel 7 SERP cheap rises over official dear', () => {
    const ranked = [
      { confidence: 92, price: 34_549, id: 'official' },
      { confidence: 90, price: 34_911, id: 'mid' },
      { confidence: 88, price: 24_682, id: 'grey' },
    ];
    const out = pickCheapestAmongCloseMatches(ranked, 12);
    expect(out[0]?.id).toBe('grey');
    expect(out.slice(0, 3).map((r) => r.price)).toContain(24_682);
  });
});

describe('hasLargePriceSpreadAmongClose', () => {
  it('detects >=5% spread', () => {
    expect(
      hasLargePriceSpreadAmongClose([
        { confidence: 80, price: 10_000 },
        { confidence: 78, price: 10_600 },
      ]),
    ).toBe(true);
    expect(
      hasLargePriceSpreadAmongClose([
        { confidence: 80, price: 10_000 },
        { confidence: 78, price: 10_400 },
      ]),
    ).toBe(false);
  });
});

describe('WB SearchCandidate imageUrl from nmId', () => {
  it('fills non-empty basket CDN imageUrl for parsed card', () => {
    const html = `<!DOCTYPE html><html><body>
      <article class="product-card" data-nm-id="215408771">
        <a href="https://www.wildberries.ru/catalog/215408771/detail.aspx">
          <span class="product-card__name">Test Product</span>
        </a>
        <ins class="price__current">1 990 ₽</ins>
      </article>
    </body></html>`;
    const [candidate] = parseWildberriesSerpHtml(html, 'Test');
    expect(candidate).toBeDefined();
    expect(candidate!.imageUrl).toBe(buildWbImageUrl('215408771'));
    expect(candidate!.imageUrl).toMatch(/^https:\/\/basket-\d+\.wbbasket\.ru\//);
    expect(candidate!.imageUrlAlternatives?.length).toBeGreaterThan(0);
  });
});

describe('pickSearchFromCandidates cheap Pixel 7 (YM parity)', () => {
  const refTitle = 'Смартфон Google Pixel 7 8/128Gb Lemongrass';
  const candidates = [
    {
      title: 'Смартфон Google Pixel 7 8/128Gb',
      url: 'https://market.yandex.ru/card/pixel-7-official/111',
      price: 34_549,
      rating: 5.0,
    },
    {
      title: 'Смартфон Google Pixel 7 8/128Gb',
      url: 'https://market.yandex.ru/card/pixel-7-mid/222',
      price: 34_911,
      rating: 4.8,
    },
    {
      title: 'Смартфон Google Pixel 7 8/128Gb Lemongrass',
      url: 'https://market.yandex.ru/card/pixel-7-grey/333',
      price: 24_682,
      rating: null,
    },
  ];

  it('top-3 includes SERP price ≤26k near ref 23098', () => {
    const { ranked } = pickSearchFromCandidates(
      'yandex_market',
      'Google Pixel 7 128',
      refTitle,
      candidates,
      { referencePrice: 23_098 },
    );
    const prices = ranked.map((r) => r.candidate.price).filter((p): p is number => p != null);
    expect(prices.some((p) => p <= 26_000)).toBe(true);
    expect(ranked[0]?.candidate.price).toBeLessThanOrEqual(26_000);
  });
});

describe('cheap-offer ranking parity WB + Ozon', () => {
  const refTitle = 'Смартфон Google Pixel 7 8/128Gb Lemongrass';

  it('WB: cheapest same-model rises with ref price', () => {
    const { ranked } = pickSearchFromCandidates(
      'wildberries',
      'Google Pixel 7 128',
      refTitle,
      [
        {
          title: 'Смартфон Google Pixel 7 8/128Gb',
          url: 'https://www.wildberries.ru/catalog/111111111/detail.aspx',
          price: 34_549,
          rating: 5,
        },
        {
          title: 'Смартфон Google Pixel 7 8/128Gb Lemongrass',
          url: 'https://www.wildberries.ru/catalog/222222222/detail.aspx',
          price: 24_682,
          rating: null,
        },
      ],
      { referencePrice: 23_098 },
    );
    expect(ranked[0]?.candidate.price).toBe(24_682);
  });

  it('Ozon: cheapest same-model rises with ref price', () => {
    const { ranked } = pickSearchFromCandidates(
      'ozon',
      'Google Pixel 7 128',
      refTitle,
      [
        {
          title: 'Смартфон Google Pixel 7 8/128Gb',
          url: 'https://www.ozon.ru/product/pixel-7-111111111/',
          price: 34_549,
          rating: 5,
        },
        {
          title: 'Смартфон Google Pixel 7 8/128Gb Lemongrass',
          url: 'https://www.ozon.ru/product/pixel-7-222222222/',
          price: 24_682,
          rating: null,
        },
      ],
      { referencePrice: 23_098 },
    );
    expect(ranked[0]?.candidate.price).toBe(24_682);
  });

  it('XM5 ref excludes XM6 from ranked WB candidates (QA P1-2)', () => {
    const ref = 'Sony WH-1000XM5 беспроводные наушники';
    const { ranked } = pickSearchFromCandidates(
      'wildberries',
      'Sony WH-1000XM5',
      ref,
      [
        {
          title: 'Sony WH-1000XM6 беспроводные наушники',
          url: 'https://www.wildberries.ru/catalog/1200598856/detail.aspx',
          price: 14_667,
          rating: null,
        },
        {
          title: 'Sony WH-1000XM5 синие',
          url: 'https://www.wildberries.ru/catalog/811830372/detail.aspx',
          price: 25_179,
          rating: null,
        },
      ],
      { referencePrice: 17_802 },
    );
    expect(ranked.every((r) => !/xm6/i.test(r.candidate.title))).toBe(true);
    expect(ranked[0]?.candidate.title.toLowerCase()).toMatch(/xm5/);
  });
});

describe('SERP article dedupe keeps min price (WB + Ozon)', () => {
  it('WB: same nmId keeps cheaper tile price', () => {
    const html = `<!DOCTYPE html><html><body>
      <article class="product-card" data-nm-id="123456789">
        <a href="https://www.wildberries.ru/catalog/123456789/detail.aspx">
          <span class="product-card__name">Смартфон Google Pixel 7</span>
        </a>
        <ins class="price__current">34 549 ₽</ins>
      </article>
      <article class="product-card" data-nm-id="123456789">
        <a href="https://www.wildberries.ru/catalog/123456789/detail.aspx?foo=1">
          <span class="product-card__name">Смартфон Google Pixel 7</span>
        </a>
        <ins class="price__current">24 682 ₽</ins>
      </article>
    </body></html>`;
    const list = parseWildberriesSerpHtml(html, 'Pixel 7');
    expect(list).toHaveLength(1);
    expect(list[0]!.price).toBe(24_682);
  });
});
