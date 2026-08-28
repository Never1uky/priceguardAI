/**
 * Edge shared: Mega/Ali/M.Video SERP match + compare-research targets (MEGA-5 / ALI-5 / MVIDEO-5).
 */
import { describe, expect, it } from 'vitest';
import {
  COMPARE_RESEARCH_VALID,
  megaSerpMatchConfidence,
  parseAliExpressSerpHtml,
  parseMegamarketSerpHtml,
  parseMvideoSerpHtml,
  resolveCompareResearchTargets,
} from './marketplace-search-core.ts';

describe('resolveCompareResearchTargets (MEGA-5 / ALI-5 / MVIDEO-5)', () => {
  it('fallback is VALID minus source (includes megamarket + aliexpress + mvideo)', () => {
    expect(resolveCompareResearchTargets('wildberries', undefined).sort()).toEqual(
      ['aliexpress', 'megamarket', 'mvideo', 'ozon', 'yandex_market'].sort(),
    );
    expect(COMPARE_RESEARCH_VALID).toContain('megamarket');
    expect(COMPARE_RESEARCH_VALID).toContain('aliexpress');
    expect(COMPARE_RESEARCH_VALID).toContain('mvideo');
  });

  it('intersects with selected — megamarket + aliexpress + mvideo when selected', () => {
    expect(
      resolveCompareResearchTargets('wildberries', [
        'ozon',
        'megamarket',
        'aliexpress',
        'mvideo',
        'dns',
      ]),
    ).toEqual(['ozon', 'megamarket', 'aliexpress', 'mvideo']);
  });

  it('source megamarket may research trio + ali + mvideo', () => {
    expect(
      resolveCompareResearchTargets('megamarket', [
        'wildberries',
        'ozon',
        'yandex_market',
        'aliexpress',
        'mvideo',
      ]).sort(),
    ).toEqual(['aliexpress', 'mvideo', 'ozon', 'wildberries', 'yandex_market']);
  });

  it('source aliexpress may research trio + mega + mvideo', () => {
    expect(
      resolveCompareResearchTargets('aliexpress', [
        'wildberries',
        'ozon',
        'megamarket',
        'mvideo',
      ]).sort(),
    ).toEqual(['megamarket', 'mvideo', 'ozon', 'wildberries']);
  });

  it('source mvideo may research trio + mega + ali', () => {
    expect(
      resolveCompareResearchTargets('mvideo', [
        'wildberries',
        'ozon',
        'megamarket',
        'aliexpress',
      ]).sort(),
    ).toEqual(['aliexpress', 'megamarket', 'ozon', 'wildberries']);
  });

  it('does not expand to remaining test MPs', () => {
    expect(resolveCompareResearchTargets('ozon', ['lamoda', 'dns', 'citilink'])).toEqual([]);
  });
});

describe('megaSerpMatchConfidence', () => {
  const PIXEL = 'Смартфон Google Pixel 10 128GB';

  it('rejects EN Ali accessory junk vs phone / laptop', () => {
    expect(megaSerpMatchConfidence(PIXEL, 'Soft TPU Case Cover for Google Pixel 10')).toBe(0);
    expect(
      megaSerpMatchConfidence(PIXEL, 'Tempered Glass Screen Protector for Pixel 10'),
    ).toBe(0);
    expect(
      megaSerpMatchConfidence(
        'Ноутбук ASUS VivoBook 15',
        'Laptop Sleeve Bag 15.6 Soft Case for ASUS',
      ),
    ).toBe(0);
  });

  it('allows accessory vs accessory on Edge rank', () => {
    expect(
      megaSerpMatchConfidence(
        'Чехол для Pixel 10',
        'Soft TPU Case Cover for Google Pixel 10',
      ),
    ).toBeGreaterThan(0);
  });

  it('rejects storage mismatch', () => {
    expect(megaSerpMatchConfidence(PIXEL, 'Смартфон Google Pixel 10 256GB')).toBe(0);
    expect(megaSerpMatchConfidence('Pixel 12/128Gb', 'Pixel 10 256GB')).toBe(0);
  });

  it('keeps same-storage phone', () => {
    expect(
      megaSerpMatchConfidence(PIXEL, 'Смартфон Google Pixel 10 128 ГБ Indigo'),
    ).toBeGreaterThan(0);
  });

  it('drops Fold муляж / photo prop when ref is a real phone', () => {
    expect(
      megaSerpMatchConfidence(
        PIXEL,
        'Муляж телефона Samsung Galaxy Z Fold8 реквизит для фотосъемки',
      ),
    ).toBe(0);
  });
});

describe('parseMegamarketSerpHtml', () => {
  it('extracts details tiles and drops junk via match gate', () => {
    const html = `
      <div data-product-id="999888777666">
        <h3>Смартфон Google Pixel 10 128 ГБ</h3>
        <span>78 500 ₽</span>
      </div>
      <div data-product-id="600023701542">
        <h3>Комод Вега Люкс</h3>
        <span>12 990 ₽</span>
      </div>
      <a href="/catalog/details/pixel-111222333444/">Google Pixel 10 128GB Black</a>
    `;
    const rows = parseMegamarketSerpHtml(html, 'Смартфон Google Pixel 10 128GB');
    expect(rows.every((r) => r.matchConfidence > 0)).toBe(true);
    expect(rows.some((r) => /Pixel/i.test(r.title))).toBe(true);
    expect(rows.some((r) => /комод/i.test(r.title))).toBe(false);
    expect(rows[0]?.url).toMatch(/\/catalog\/details\/\d+\//);
  });

  it('returns empty for tiny / blocked shells', () => {
    expect(parseMegamarketSerpHtml('captcha', 'Pixel')).toEqual([]);
  });
});

describe('parseAliExpressSerpHtml (ALI-5)', () => {
  it('extracts /item tiles and drops junk via match gate', () => {
    const html = `
      <a href="/item/1005001111222233.html" title="Смартфон Google Pixel 10 128 ГБ">
        Pixel 10 128GB
        <span>12 990 ₽</span>
      </a>
      <a href="/item/1005009999888877.html" title="Комод Вега Люкс">Комод</a>
      <a href="/item/1005005555666677.html">Чехол для Pixel 10</a>
    `;
    const rows = parseAliExpressSerpHtml(html, 'Смартфон Google Pixel 10 128GB');
    expect(rows.every((r) => r.matchConfidence > 0)).toBe(true);
    expect(rows.some((r) => /Pixel/i.test(r.title))).toBe(true);
    expect(rows.some((r) => /комод|чехол/i.test(r.title))).toBe(false);
    expect(rows[0]?.url).toMatch(/aliexpress\.ru\/item\/\d+\.html/);
  });

  it('returns empty for tiny / blocked shells', () => {
    expect(parseAliExpressSerpHtml('captcha', 'Pixel')).toEqual([]);
  });
});

describe('parseMvideoSerpHtml (MVIDEO-5)', () => {
  it('extracts /products tiles and drops junk via match gate', () => {
    const html = `
      <a href="/products/smartfon-google-pixel-10-30066712/" title="Смартфон Google Pixel 10 128 ГБ">
        Pixel 10 128GB
        <span>78 500 ₽</span>
      </a>
      <a href="/products/komod-vega-400111222/" title="Комод Вега Люкс">Комод</a>
      <a href="/products/chehol-pixel-400333444/">Чехол для Pixel 10</a>
      <a href="https://www.eldorado.ru/cat/detail/phone-12345678/">Google Pixel 10 128GB Black</a>
    `;
    const rows = parseMvideoSerpHtml(html, 'Смартфон Google Pixel 10 128GB');
    expect(rows.every((r) => r.matchConfidence > 0)).toBe(true);
    expect(rows.some((r) => /Pixel/i.test(r.title))).toBe(true);
    expect(rows.some((r) => /комод|чехол/i.test(r.title))).toBe(false);
    expect(rows.some((r) => /mvideo\.ru\/products\/\d+/.test(r.url))).toBe(true);
  });

  it('returns empty for tiny / blocked shells', () => {
    expect(parseMvideoSerpHtml('captcha', 'Pixel')).toEqual([]);
  });
});
