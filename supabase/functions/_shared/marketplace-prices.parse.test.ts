import { describe, expect, it } from 'vitest';
import {
  parseOzonPriceFromHtml,
  parseYmPriceFromHtml,
  parseWbPriceFromHtml,
  effectiveServerDropThresholds,
  isSignificantDrop,
  OZON_SERVER_DROP_MARGIN_RUB,
  OZON_SERVER_DROP_MARGIN_PCT,
} from './marketplace-prices.ts';

describe('parseOzonPriceFromHtml', () => {
  it('parses meta itemprop price', () => {
    const html = `
      <html><head>
        <meta property="og:title" content="Test Product — Ozon" />
        <meta itemprop="price" content="1299" />
      </head></html>`;
    const r = parseOzonPriceFromHtml(html, 'https://www.ozon.ru/product/test-123/');
    expect(r?.price).toBe(1299);
    expect(r?.title).toContain('Test Product');
  });

  it('returns null on captcha page', () => {
    const html = '<html>Access Denied challenge</html>';
    expect(parseOzonPriceFromHtml(html, 'https://www.ozon.ru/product/x/')).toBeNull();
  });
});

describe('parseYmPriceFromHtml', () => {
  it('parses ld+json Product offer', () => {
    const html = `
      <script type="application/ld+json">
      {"@type":"Product","name":"YM Item","offers":{"@type":"Offer","price":"4590"}}
      </script>`;
    const r = parseYmPriceFromHtml(html);
    expect(r?.price).toBe(4590);
  });

  it('returns null on showcaptcha', () => {
    const html = '<html>showcaptcha</html>';
    expect(parseYmPriceFromHtml(html)).toBeNull();
  });
});

describe('parseWbPriceFromHtml', () => {
  it('parses salePriceU in kopecks', () => {
    const html = '{"salePriceU":199900,"imt_name":"Phone","brand":"Brand"}';
    const r = parseWbPriceFromHtml(html, 'https://www.wildberries.ru/catalog/1/detail.aspx');
    expect(r?.price).toBe(1999);
    expect(r?.title).toContain('Brand');
  });
});

describe('effectiveServerDropThresholds', () => {
  it('adds Ozon margin on top of user mins', () => {
    const t = effectiveServerDropThresholds('ozon', 100, 1);
    expect(t.minDropRub).toBe(100 + OZON_SERVER_DROP_MARGIN_RUB);
    expect(t.minDropPercent).toBe(1 + OZON_SERVER_DROP_MARGIN_PCT);
  });

  it('leaves WB / YM unchanged', () => {
    expect(effectiveServerDropThresholds('wildberries', 100, 1)).toEqual({
      minDropRub: 100,
      minDropPercent: 1,
    });
    expect(effectiveServerDropThresholds('yandex_market', 50, 2)).toEqual({
      minDropRub: 50,
      minDropPercent: 2,
    });
  });

  it('Ozon margin blocks small drops that pass raw user thresholds', () => {
    const prev = 10_000;
    const next = 9_850; // −150 ₽ / 1.5% — above user 100₽/1%, below ozon 200₽/3%
    expect(isSignificantDrop(prev, next, 100, 1)).toBe(true);
    const { minDropRub, minDropPercent } = effectiveServerDropThresholds('ozon', 100, 1);
    expect(isSignificantDrop(prev, next, minDropRub, minDropPercent)).toBe(false);
  });
});
