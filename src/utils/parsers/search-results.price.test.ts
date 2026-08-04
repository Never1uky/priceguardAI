/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from 'vitest';
import {
  parseWildberriesSerpHtml,
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
