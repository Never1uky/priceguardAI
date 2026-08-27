/**
 * Edge shared: Mega/Ali SERP match + compare-research targets (MEGA-5 / ALI-5).
 */
import { describe, expect, it } from 'vitest';
import {
  COMPARE_RESEARCH_VALID,
  megaSerpMatchConfidence,
  parseAliExpressSerpHtml,
  parseMegamarketSerpHtml,
  resolveCompareResearchTargets,
} from './marketplace-search-core.ts';

describe('resolveCompareResearchTargets (MEGA-5 / ALI-5)', () => {
  it('fallback is VALID minus source (includes megamarket + aliexpress)', () => {
    expect(resolveCompareResearchTargets('wildberries', undefined).sort()).toEqual(
      ['aliexpress', 'megamarket', 'ozon', 'yandex_market'].sort(),
    );
    expect(COMPARE_RESEARCH_VALID).toContain('megamarket');
    expect(COMPARE_RESEARCH_VALID).toContain('aliexpress');
  });

  it('intersects with selected — megamarket + aliexpress when selected', () => {
    expect(
      resolveCompareResearchTargets('wildberries', [
        'ozon',
        'megamarket',
        'aliexpress',
        'dns',
      ]),
    ).toEqual(['ozon', 'megamarket', 'aliexpress']);
  });

  it('source megamarket may research trio + ali', () => {
    expect(
      resolveCompareResearchTargets('megamarket', [
        'wildberries',
        'ozon',
        'yandex_market',
        'aliexpress',
      ]).sort(),
    ).toEqual(['aliexpress', 'ozon', 'wildberries', 'yandex_market']);
  });

  it('source aliexpress may research trio + mega', () => {
    expect(
      resolveCompareResearchTargets('aliexpress', [
        'wildberries',
        'ozon',
        'megamarket',
      ]).sort(),
    ).toEqual(['megamarket', 'ozon', 'wildberries']);
  });

  it('does not expand to test MPs', () => {
    expect(resolveCompareResearchTargets('ozon', ['lamoda', 'dns', 'mvideo'])).toEqual([]);
  });
});

describe('megaSerpMatchConfidence', () => {
  const PIXEL = 'Смартфон Google Pixel 10 128GB';

  it('rejects furniture / food / case junk', () => {
    expect(megaSerpMatchConfidence(PIXEL, 'Комод Вега Люкс 8Я')).toBe(0);
    expect(megaSerpMatchConfidence(PIXEL, 'Крабовые палочки 180 г')).toBe(0);
    expect(megaSerpMatchConfidence(PIXEL, 'Чехол для Pixel 10')).toBe(0);
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
