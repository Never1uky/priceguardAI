/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildAliExpressItemUrl,
  isAliExpressOutOfStockText,
  parseAliExpressProduct,
  plausibleAliArticle,
  titleWithBrand,
} from '@/utils/parsers/aliexpress';
import { scrapeAliExpressCandidates, pickSearchFromCandidates } from '@/utils/parsers/search-results';
import { detectMarketplace, extractArticle, isProductPage } from '@/utils/marketplace';
import { toCanonicalProductUrl } from '@/utils/product-url';
import { getMarketplaceEntry } from '@/lib/marketplaces/registry';
import { isGenericCardMarketplace } from '@/lib/marketplaces/adapter-config';
import { isPremiumUnlockerMarketplace } from '@/lib/premium-unlocker-offer';
import { skipsTelegramAlertsForMarketplace } from '@/lib/price-alert-dispatch';
import { prefixedStorageId, stableProductStorageId } from '@/lib/price-identity';
import type { SearchCandidate } from '@/utils/parsers/search-results';

function setLocation(href: string) {
  Object.defineProperty(window, 'location', {
    value: new URL(href),
    writable: true,
    configurable: true,
  });
}

describe('aliexpress helpers', () => {
  it('plausibleAliArticle requires 8+ digits', () => {
    expect(plausibleAliArticle('1005006123456789')).toBe('1005006123456789');
    expect(plausibleAliArticle('1234567')).toBe('');
    expect(plausibleAliArticle('ae-1005006123456789')).toBe('1005006123456789');
  });

  it('buildAliExpressItemUrl canonical form', () => {
    expect(buildAliExpressItemUrl('1005006123456789')).toBe(
      'https://aliexpress.ru/item/1005006123456789.html',
    );
  });

  it('titleWithBrand prepends when missing', () => {
    expect(titleWithBrand('Pixel 10 128GB', 'Google')).toBe('Google Pixel 10 128GB');
    expect(titleWithBrand('Google Pixel 10', 'Google')).toBe('Google Pixel 10');
  });

  it('OOS text detection', () => {
    expect(isAliExpressOutOfStockText('Товар недоступен')).toBe(true);
    expect(isAliExpressOutOfStockText('В корзину')).toBe(false);
  });
});

describe('aliexpress detect / URL', () => {
  it('detects product and SERP', () => {
    expect(detectMarketplace('https://aliexpress.ru/item/1005006123456789.html')).toBe(
      'aliexpress',
    );
    expect(isProductPage('https://aliexpress.ru/item/1005006123456789.html')).toBe(true);
    expect(isProductPage('https://aliexpress.ru/wholesale?SearchText=iphone')).toBe(false);
  });

  it('canonicalizes www + query to aliexpress.ru/item/{id}.html', () => {
    expect(
      toCanonicalProductUrl(
        'https://www.aliexpress.ru/item/1005006123456789.html?spm=a2g0o&algo=x',
        'aliexpress',
      ),
    ).toBe('https://aliexpress.ru/item/1005006123456789.html');
  });

  it('extractArticle from item URL', () => {
    expect(
      extractArticle('https://aliexpress.ru/item/1005006123456789.html?x=1', 'aliexpress'),
    ).toBe('1005006123456789');
  });
});

describe('parseAliExpressProduct', () => {
  beforeEach(() => {
    document.documentElement.innerHTML = '<html><head></head><body></body></html>';
  });

  it('parses JSON-LD happy path', () => {
    setLocation('https://aliexpress.ru/item/1005006123456789.html?utm=1');
    document.head.innerHTML = `
      <script type="application/ld+json">
      ${JSON.stringify({
        '@type': 'Product',
        name: 'Смартфон Google Pixel 10 128GB',
        sku: '1005006123456789',
        brand: { '@type': 'Brand', name: 'Google' },
        image: 'https://ae01.alicdn.com/kf/product.jpg',
        offers: { '@type': 'Offer', price: '79990', priceCurrency: 'RUB', availability: 'InStock' },
      })}
      </script>
    `;
    document.body.innerHTML = '<h1>fallback</h1>';
    const p = parseAliExpressProduct();
    expect(p).not.toBeNull();
    expect(p!.marketplace).toBe('aliexpress');
    expect(p!.title).toMatch(/Google/i);
    expect(p!.price).toBe(79990);
    expect(p!.article).toBe('1005006123456789');
    expect(p!.url).toBe('https://aliexpress.ru/item/1005006123456789.html');
    expect(p!.availability).toBe('in_stock');
  });

  it('marks OOS when LD says OutOfStock', () => {
    setLocation('https://aliexpress.ru/item/1005006123456789.html');
    document.head.innerHTML = `
      <script type="application/ld+json">
      ${JSON.stringify({
        '@type': 'Product',
        name: 'Чехол',
        sku: '1005006123456789',
        offers: {
          '@type': 'Offer',
          price: '0',
          availability: 'https://schema.org/OutOfStock',
        },
      })}
      </script>
    `;
    const p = parseAliExpressProduct();
    expect(p!.price).toBe(0);
    expect(p!.availability).toBe('out_of_stock');
  });

  it('returns null on wholesale SERP URL', () => {
    setLocation('https://aliexpress.ru/wholesale?SearchText=iphone');
    document.body.innerHTML = '<h1>Search</h1>';
    expect(parseAliExpressProduct()).toBeNull();
  });

  it('DOM fallback for title + price', () => {
    setLocation('https://aliexpress.ru/item/1005009999888777.html');
    document.body.innerHTML = `
      <h1>Наушники Xiaomi Buds</h1>
      <div class="price">4 990 ₽</div>
    `;
    const p = parseAliExpressProduct();
    expect(p!.title).toMatch(/Xiaomi/i);
    expect(p!.price).toBe(4990);
    expect(p!.article).toBe('1005009999888777');
  });
});

describe('scrapeAliExpressCandidates', () => {
  beforeEach(() => {
    document.documentElement.innerHTML = '<html><head></head><body></body></html>';
  });

  it('returns item tiles with prices and canonical URLs', () => {
    document.body.innerHTML = `
      <a href="https://aliexpress.ru/item/1005001111222333.html?spm=x">
        <h3>Xiaomi Phone</h3>
        <span>15 990 ₽</span>
      </a>
      <a href="https://www.aliexpress.ru/item/1005004444555666.html">
        <h3>Sony Headphones</h3>
        <span>8 490 руб</span>
      </a>
    `;
    const c = scrapeAliExpressCandidates('xiaomi');
    expect(c.length).toBe(2);
    expect(c.every((x) => /\/item\/\d+\.html$/.test(x.url))).toBe(true);
    expect(c[0]!.url).not.toContain('?');
    expect(c.some((x) => x.price === 15990)).toBe(true);
  });

  it('dedupes duplicate item hrefs by article', () => {
    document.body.innerHTML = `
      <div class="product-card">
        <a href="https://aliexpress.ru/item/1005001111222333.html"><h3>Phone A</h3><span>1200 ₽</span></a>
      </div>
      <div class="product-card">
        <a href="https://aliexpress.ru/item/1005001111222333.html?utm=1"><h3>Phone A2</h3><span>900 ₽</span></a>
      </div>
    `;
    const c = scrapeAliExpressCandidates('phone');
    expect(c.length).toBe(1);
    expect(c[0]!.url).toBe('https://aliexpress.ru/item/1005001111222333.html');
    expect(c[0]!.price).toBeGreaterThan(0);
  });

  it('skips wholesale links and short ids', () => {
    document.body.innerHTML = `
      <a href="https://aliexpress.ru/wholesale?SearchText=iphone"><h3>Search</h3></a>
      <a href="https://aliexpress.ru/item/1234567.html"><h3>Short</h3><span>100 ₽</span></a>
    `;
    expect(scrapeAliExpressCandidates('iphone')).toEqual([]);
  });
});

describe('aliexpress SERP junk filter (parity with Mega)', () => {
  const PIXEL_128 = 'Смартфон Google Pixel 10 128GB';

  function cand(title: string, id: string, price: number | null): SearchCandidate {
    return {
      title,
      url: `https://aliexpress.ru/item/${id}.html`,
      price,
      rating: null,
    };
  }

  it('drops furniture / food / case; keeps same-storage phone', () => {
    const result = pickSearchFromCandidates(
      'aliexpress',
      'Google Pixel 10 128GB',
      PIXEL_128,
      [
        cand('Комод Вега Люкс', '1005006000237015', 12_990),
        cand('Крабовые палочки', '1005001112223334', 75),
        cand('Чехол для Google Pixel 10', '1005001112223335', 990),
        cand('Смартфон Google Pixel 10 128 ГБ Indigo', '1005009998887776', 78_500),
      ],
      { referencePrice: 79_990 },
    );
    const titles = [
      result.offer.title,
      ...(result.offer.searchCandidates?.map((c) => c.title) ?? []),
    ]
      .filter(Boolean)
      .join(' ');
    expect(result.offer.matchStatus === 'not_found').toBe(false);
    expect(titles).toMatch(/Pixel\s*10/i);
    expect(titles).not.toMatch(/комод|крабов|чехол/i);
  });
});

describe('ALI-1/2/3/6 policy guards', () => {
  it('Ali default-on; unlocker on; ae- identity; TG alerts skipped', () => {
    expect(getMarketplaceEntry('aliexpress')?.enabledByDefault).toBe(true);
    expect(getMarketplaceEntry('wildberries')?.enabledByDefault).toBe(true);
    expect(getMarketplaceEntry('megamarket')?.enabledByDefault).toBe(true);
    expect(getMarketplaceEntry('lamoda')?.enabledByDefault).toBe(false);
    expect(isGenericCardMarketplace('aliexpress')).toBe(false);
    expect(isGenericCardMarketplace('mvideo')).toBe(true);
    expect(isPremiumUnlockerMarketplace('aliexpress')).toBe(true);
    expect(isPremiumUnlockerMarketplace('megamarket')).toBe(true);
    expect(prefixedStorageId('aliexpress', '1005001234567890')).toBe('ae-1005001234567890');
    expect(
      stableProductStorageId({
        marketplace: 'aliexpress',
        url: 'https://aliexpress.ru/item/1005001234567890.html',
      }),
    ).toBe('ae-1005001234567890');
    expect(skipsTelegramAlertsForMarketplace('aliexpress')).toBe(true);
    expect(skipsTelegramAlertsForMarketplace('megamarket')).toBe(true);
    expect(skipsTelegramAlertsForMarketplace('wildberries')).toBe(false);
    expect(getMarketplaceEntry('aliexpress')?.capabilities.reviews).toBe(false);
  });
});
