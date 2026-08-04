/** @vitest-environment happy-dom */
import { describe, expect, it } from 'vitest';
import {
  detectOzonAntibot,
  errorSuggestsVpnHint,
  parseOzonSerpDomCandidates,
  scanOzonSerpDom,
} from '@/lib/ozon-serp-dom';

function parseHtml(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

describe('ozon-serp-dom', () => {
  it('parses product tiles from SERP HTML', () => {
    const doc = parseHtml(`
      <html><body>
        <div data-widget="searchResultsV2">
          <div data-index="0">
            <a href="/product/kastrulya-taller-3516900408/" title="Кастрюля TalleR TR-98101 2л">
              <span class="tsBody">Кастрюля TalleR</span>
              <span>4,8 ★</span>
              <span>312 отзывов</span>
              <span>3 313 ₽</span>
            </a>
          </div>
          <div data-index="1">
            <a href="https://www.ozon.ru/product/airpods-max-123/">
              AirPods Max
              <span>42 149 ₽</span>
            </a>
          </div>
        </div>
      </body></html>
    `);

    const candidates = parseOzonSerpDomCandidates(doc, 'кастрюля');
    expect(candidates.length).toBeGreaterThanOrEqual(2);
    expect(candidates[0]?.url).toMatch(/\/product\//);
    expect(candidates.some((c) => c.price != null && c.price > 0)).toBe(true);
    expect(candidates[0]?.rating).toBe(4.8);
    expect(candidates[0]?.reviewCount).toBe(312);
  });

  it('keeps tiles without price as candidates', () => {
    const doc = parseHtml(`
      <html><body>
        <a href="/product/no-price-999/" title="Товар без цены">Товар без цены</a>
      </body></html>
    `);
    const candidates = parseOzonSerpDomCandidates(doc, 'товар');
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.price).toBeNull();
  });

  it('parses /product/ tiles from category SERP HTML', () => {
    const doc = parseHtml(`
      <html><body>
        <div data-widget="searchResultsV2">
          <div data-index="0">
            <a href="/product/xiaomi-redmi-15-2834436392/" title="Xiaomi Redmi 15">
              Xiaomi Redmi 15
              <span>4,7 ★</span>
              <span>15 340 ₽</span>
            </a>
          </div>
        </div>
      </body></html>
    `);
    // Category pages still expose /product/ anchors — must not be empty
    const candidates = parseOzonSerpDomCandidates(doc, 'Xiaomi Redmi 15');
    expect(candidates.length).toBe(1);
    expect(candidates[0]?.url).toMatch(/\/product\/xiaomi-redmi/);
    expect(candidates[0]?.rating).toBe(4.7);
  });

  it('skips Ozon promo badges in tile link text', () => {
    const doc = parseHtml(`
      <html><body>
        <div data-index="0">
          <a href="/product/krossovki-trace-low-m-123/">
            Распрод
            <span class="tsBody">Кроссовки TRACE LOW M</span>
            <span>4 990 ₽</span>
          </a>
        </div>
      </body></html>
    `);
    const candidates = parseOzonSerpDomCandidates(doc, 'кроссовки');
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.title).toMatch(/TRACE LOW M/i);
    expect(candidates[0]?.title).not.toMatch(/распрод/i);
  });

  it('ignores category-only links without /product/', () => {
    const doc = parseHtml(`
      <html><body>
        <a href="/category/smartfony-15502/?text=xiaomi">Category</a>
      </body></html>
    `);
    expect(parseOzonSerpDomCandidates(doc, 'xiaomi')).toHaveLength(0);
  });

  it('detects antibot when challenge present and no products', () => {
    const doc = parseHtml(`
      <html><body>
        <p>Подтвердите, что вы не робот</p>
        <iframe src="https://ozon.ru/captcha"></iframe>
      </body></html>
    `);
    expect(detectOzonAntibot(doc, 0)).toBe(true);
    expect(scanOzonSerpDom(doc, 'x').antibot).toBe(true);
  });

  it('does not flag antibot when products exist', () => {
    const doc = parseHtml(`
      <html><body>
        <p>captcha mentioned in footer</p>
        <a href="/product/ok-1/">Ok <span>100 ₽</span></a>
      </body></html>
    `);
    const scan = scanOzonSerpDom(doc, 'ok');
    expect(scan.candidates.length).toBeGreaterThan(0);
    expect(scan.antibot).toBe(false);
  });

  it('errorSuggestsVpnHint for block / rate-limit copy', () => {
    expect(errorSuggestsVpnHint('Ozon временно ограничивает автоматический поиск')).toBe(true);
    expect(errorSuggestsVpnHint('Wildberries временно недоступен из‑за лимита запросов')).toBe(
      true,
    );
    expect(errorSuggestsVpnHint('Подходящий товар в выдаче не найден')).toBe(false);
  });
});
