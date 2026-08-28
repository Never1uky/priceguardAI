/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, beforeEach } from 'vitest';
import {
  isMegamarketOutOfStockText,
  parseMegamarketProduct,
  scrapeMegamarketSellerFromDom,
  titleWithBrand,
} from '@/utils/parsers/megamarket';
import { scrapeMegamarketCandidates } from '@/utils/parsers/search-results';
import { detectMarketplace, extractArticle, isProductPage } from '@/utils/marketplace';
import { toCanonicalProductUrl } from '@/utils/product-url';
import { scoreProductMatch } from '@/lib/product-match';
import { getReviewCacheKey } from '@/lib/reviews/cache-key';
import { DEFAULT_SEARCH_MARKETPLACE_IDS, MARKETPLACES } from '@/lib/marketplaces/registry';
import { isPremiumUnlockerMarketplace } from '@/lib/premium-unlocker-offer';

function setLocation(href: string): void {
  Object.defineProperty(window, 'location', {
    value: new URL(href),
    writable: true,
    configurable: true,
  });
}

describe('megamarket detect / URL / article', () => {
  it('detects megamarket.ru and sbermegamarket.ru', () => {
    expect(detectMarketplace('https://megamarket.ru/catalog/details/1234567890/')).toBe(
      'megamarket',
    );
    expect(
      detectMarketplace('https://www.sbermegamarket.ru/catalog/details/phone-9876543210/'),
    ).toBe('megamarket');
  });

  it('isProductPage only for /catalog/details/', () => {
    expect(isProductPage('https://megamarket.ru/catalog/details/1234567890/')).toBe(true);
    expect(isProductPage('https://megamarket.ru/catalog/?q=iphone')).toBe(false);
  });

  it('canonicalizes sber host and strips query', () => {
    expect(
      toCanonicalProductUrl(
        'https://sbermegamarket.ru/catalog/details/smartfon-1234567890/?utm=1#x',
        'megamarket',
      ),
    ).toBe('https://megamarket.ru/catalog/details/smartfon-1234567890');
  });

  it('extracts product id from slug and bare details URL', () => {
    expect(
      extractArticle(
        'https://megamarket.ru/catalog/details/smartfon-xiaomi-1002003004/',
        'megamarket',
      ),
    ).toBe('1002003004');
    expect(
      extractArticle('https://megamarket.ru/catalog/details/1002003004/?q=1', 'megamarket'),
    ).toBe('1002003004');
    expect(extractArticle('https://megamarket.ru/catalog/?q=phone', 'megamarket')).toBe('');
  });
});

describe('titleWithBrand / OOS helpers', () => {
  it('prepends brand when missing', () => {
    expect(titleWithBrand('Смартфон Note 15', 'Xiaomi')).toBe('Xiaomi Смартфон Note 15');
    expect(titleWithBrand('Xiaomi Note 15', 'Xiaomi')).toBe('Xiaomi Note 15');
  });

  it('detects OOS phrases', () => {
    expect(isMegamarketOutOfStockText('Товар нет в наличии')).toBe(true);
    expect(isMegamarketOutOfStockText('В корзину')).toBe(false);
  });
});

describe('parseMegamarketProduct', () => {
  beforeEach(() => {
    document.documentElement.innerHTML = '<html><head></head><body></body></html>';
  });

  it('parses JSON-LD happy path with brand, price, sku', () => {
    setLocation('https://megamarket.ru/catalog/details/smartfon-1002003004/?utm=x');
    document.documentElement.innerHTML = `
      <html><head>
        <script type="application/ld+json">${JSON.stringify({
          '@type': 'Product',
          name: 'Смартфон REDMI Note 15',
          brand: { '@type': 'Brand', name: 'Xiaomi' },
          sku: '1002003004',
          image: 'https://cdn.megamarket.ru/img.jpg',
          offers: {
            '@type': 'Offer',
            price: '24990',
            priceCurrency: 'RUB',
            availability: 'https://schema.org/InStock',
          },
        })}</script>
      </head><body><h1>Смартфон REDMI Note 15</h1></body></html>
    `;
    const p = parseMegamarketProduct();
    expect(p).not.toBeNull();
    expect(p!.marketplace).toBe('megamarket');
    expect(p!.currency).toBe('RUB');
    expect(p!.price).toBe(24990);
    expect(p!.article).toBe('1002003004');
    expect(p!.title).toMatch(/Xiaomi/i);
    expect(p!.url).toBe('https://megamarket.ru/catalog/details/smartfon-1002003004');
    expect(p!.availability).toBe('in_stock');
    expect(p!.id).toBe('megamarket:1002003004');
  });

  it('sets Product.color from title marketing name (Obsidian)', () => {
    setLocation('https://megamarket.ru/catalog/details/smartfon-1002003004/');
    document.documentElement.innerHTML = `
      <html><head>
        <script type="application/ld+json">${JSON.stringify({
          '@type': 'Product',
          name: 'Pixel 10 128GB Obsidian',
          brand: { '@type': 'Brand', name: 'Google' },
          sku: '1002003004',
          offers: {
            '@type': 'Offer',
            price: '79990',
            priceCurrency: 'RUB',
            availability: 'https://schema.org/InStock',
          },
        })}</script>
      </head><body></body></html>
    `;
    const p = parseMegamarketProduct();
    expect(p!.title).toMatch(/Google/i);
    expect(p!.color).toBe('black');
  });

  it('marks OutOfStock from schema.org even if price present', () => {
    setLocation('https://megamarket.ru/catalog/details/1002003004/');
    document.documentElement.innerHTML = `
      <html><head>
        <script type="application/ld+json">${JSON.stringify({
          '@type': 'Product',
          name: 'Товар',
          sku: '1002003004',
          offers: {
            price: '100',
            availability: 'https://schema.org/OutOfStock',
          },
        })}</script>
      </head><body></body></html>
    `;
    const p = parseMegamarketProduct();
    expect(p!.price).toBe(0);
    expect(p!.availability).toBe('out_of_stock');
  });

  it('returns null on non-details URL', () => {
    setLocation('https://megamarket.ru/catalog/?q=iphone');
    document.body.innerHTML = '<h1>Поиск</h1>';
    expect(parseMegamarketProduct()).toBeNull();
  });

  it('returns null without title', () => {
    setLocation('https://megamarket.ru/catalog/details/1002003004/');
    document.body.innerHTML = '<div>нет заголовка</div>';
    expect(parseMegamarketProduct()).toBeNull();
  });

  it('uses DOM price when JSON-LD missing', () => {
    setLocation('https://megamarket.ru/catalog/details/1002003004/');
    document.body.innerHTML = `
      <h1>Наушники Sony</h1>
      <div data-auto="price">12 990 ₽</div>
    `;
    const p = parseMegamarketProduct();
    expect(p!.price).toBe(12990);
    expect(p!.article).toBe('1002003004');
  });

  it('parses embedded __NEXT_DATA__ goods blob when JSON-LD missing', () => {
    setLocation('https://megamarket.ru/catalog/details/smartfon-700008588462/');
    document.documentElement.innerHTML = `
      <html><head>
        <script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
          props: {
            pageProps: {
              product: {
                goodsId: '700008588462',
                title: 'Смартфон Google Pixel 10 128GB Obsidian',
                brand: 'Google',
                price: 79990,
                imageUrl: 'https://cdn.example/p.jpg',
              },
            },
          },
        })}</script>
      </head><body></body></html>
    `;
    const p = parseMegamarketProduct();
    expect(p).not.toBeNull();
    expect(p!.article).toBe('700008588462');
    expect(p!.price).toBe(79990);
    expect(p!.title).toMatch(/Google/i);
    expect(p!.title).toMatch(/Pixel 10/i);
    expect(p!.color).toBe('black');
  });

  it('article from data-product-id when URL slug has no digits', () => {
    setLocation('https://megamarket.ru/catalog/details/smartfon-pixel/');
    document.body.innerHTML = `
      <div data-product-id="700008588462">
        <h1>Смартфон Google Pixel 10</h1>
        <meta itemprop="price" content="75000" />
        <div data-auto="price">75 000 ₽</div>
      </div>
    `;
    // meta itemprop may need to be in head for querySelector - also set content attr on visible
    const p = parseMegamarketProduct();
    expect(p!.article).toBe('700008588462');
    expect(p!.price).toBeGreaterThan(0);
  });

  it('scrapes seller from labeled row', () => {
    setLocation('https://megamarket.ru/catalog/details/1002003004/');
    document.body.innerHTML = `
      <h1>Товар</h1>
      <table><tr><td>Продавец</td><td>ООО МегаШоп</td></tr></table>
    `;
    expect(scrapeMegamarketSellerFromDom()).toBe('ООО МегаШоп');
  });
});

describe('scrapeMegamarketCandidates', () => {
  beforeEach(() => {
    document.documentElement.innerHTML = '<html><head></head><body></body></html>';
  });

  it('returns real product candidates with prices', () => {
    document.body.innerHTML = `
      <a href="https://megamarket.ru/catalog/details/phone-1112223334/?x=1">
        <h3>Xiaomi Phone</h3>
        <span>15 990 ₽</span>
      </a>
      <a href="https://megamarket.ru/catalog/details/phone-5556667778/">
        <h3>Sony Headphones</h3>
        <span>8 490 руб</span>
      </a>
    `;
    const c = scrapeMegamarketCandidates('xiaomi');
    expect(c.length).toBe(2);
    expect(c.every((x) => /\/catalog\/details\//.test(x.url))).toBe(true);
    expect(c[0]!.url).not.toContain('?');
    expect(c.some((x) => x.price === 15990)).toBe(true);
  });

  it('picks up data-product-id tiles without details href', () => {
    document.body.innerHTML = `
      <div data-product-id="1112223334">
        <h3>Xiaomi Redmi Note</h3>
        <span>12 490 ₽</span>
      </div>
    `;
    const c = scrapeMegamarketCandidates('redmi');
    expect(c.length).toBe(1);
    expect(c[0]!.url).toBe('https://megamarket.ru/catalog/details/1112223334');
    expect(c[0]!.price).toBe(12490);
    expect(c[0]!.title).toMatch(/Xiaomi/i);
  });

  it('dedupes duplicate detail hrefs by article', () => {
    document.body.innerHTML = `
      <a href="https://megamarket.ru/catalog/details/1112223334/"><h3>Phone A</h3><span>1000 ₽</span></a>
      <a href="https://megamarket.ru/catalog/details/1112223334/?utm=1"><h3>Phone A2</h3><span>900 ₽</span></a>
    `;
    const c = scrapeMegamarketCandidates('phone');
    expect(c.length).toBe(1);
    expect(c[0]!.url).toBe('https://megamarket.ru/catalog/details/1112223334');
    expect(c[0]!.price).toBeGreaterThan(0);
  });

  it('canonicalizes sbermegamarket SERP href to megamarket.ru', () => {
    document.body.innerHTML = `
      <a href="https://sbermegamarket.ru/catalog/details/1112223334/"><h3>Phone</h3><span>5000 ₽</span></a>
    `;
    const c = scrapeMegamarketCandidates('phone');
    expect(c.length).toBe(1);
    expect(c[0]!.url).toBe('https://megamarket.ru/catalog/details/1112223334');
  });

  it('returns empty when no product links', () => {
    document.body.innerHTML = `
      <a href="https://megamarket.ru/catalog/?q=iphone">Search</a>
    `;
    expect(scrapeMegamarketCandidates('iphone')).toEqual([]);
  });

  it('skips links without extractable article', () => {
    document.body.innerHTML = `
      <a href="https://megamarket.ru/catalog/details/abc/"><h3>Bad</h3><span>100 ₽</span></a>
    `;
    expect(scrapeMegamarketCandidates('bad')).toEqual([]);
  });
});

describe('megamarket matching / cache / defaults / unlocker', () => {
  it('uses attribute match engine on Mega titles (not a separate matcher)', () => {
    const score = scoreProductMatch(
      'Xiaomi REDMI Note 15 8/256',
      'Xiaomi Смартфон REDMI Note 15 8/256 ГБ',
    );
    expect(score).toBeGreaterThan(0.4);
  });

  it('cache key includes marketplace + article', () => {
    expect(
      getReviewCacheKey({
        marketplace: 'megamarket',
        article: '1002003004',
        url: 'https://megamarket.ru/catalog/details/1002003004/',
        id: 'x',
      }),
    ).toBe('mp:megamarket:1002003004');
  });

  it('defaults include megamarket; unlocker allowlist includes Mega (Premium card only)', () => {
    expect(DEFAULT_SEARCH_MARKETPLACE_IDS).toEqual([
      'wildberries',
      'ozon',
      'yandex_market',
      'megamarket',
      'aliexpress',
      'mvideo',
    ]);
    expect(isPremiumUnlockerMarketplace('megamarket')).toBe(true);
    expect(isPremiumUnlockerMarketplace('lamoda')).toBe(false);
    // MEGA-7 SKIP: no public reviews API / antibot — keep reviews capability off
    expect(MARKETPLACES.find((m) => m.id === 'megamarket')?.capabilities.reviews).toBe(false);
  });
});

describe('trio regression smoke', () => {
  it('still detects WB / Ozon / YM', () => {
    expect(detectMarketplace('https://www.wildberries.ru/catalog/1/detail.aspx')).toBe(
      'wildberries',
    );
    expect(detectMarketplace('https://www.ozon.ru/product/x-12345/')).toBe('ozon');
    expect(detectMarketplace('https://market.yandex.ru/product--x/123')).toBe('yandex_market');
  });
});
