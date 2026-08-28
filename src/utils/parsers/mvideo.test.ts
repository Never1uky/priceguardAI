/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  isMvideoOutOfStockText,
  parseMvideoProduct,
  plausibleMvideoArticle,
  titleWithBrand,
} from '@/utils/parsers/mvideo';
import { scrapeMvideoCandidates, pickSearchFromCandidates } from '@/utils/parsers/search-results';
import { detectMarketplace, extractArticle, isProductPage } from '@/utils/marketplace';
import { toCanonicalProductUrl } from '@/utils/product-url';
import { getMarketplaceEntry } from '@/lib/marketplaces/registry';
import { isGenericCardMarketplace } from '@/lib/marketplaces/adapter-config';
import { isPremiumUnlockerMarketplace } from '@/lib/premium-unlocker-offer';
import type { SearchCandidate } from '@/utils/parsers/search-results';

function setLocation(href: string) {
  Object.defineProperty(window, 'location', {
    value: new URL(href),
    writable: true,
    configurable: true,
  });
}

describe('mvideo helpers', () => {
  it('plausibleMvideoArticle requires 6+ digits', () => {
    expect(plausibleMvideoArticle('30066712')).toBe('30066712');
    expect(plausibleMvideoArticle('12345')).toBe('');
    expect(plausibleMvideoArticle('sku-400522544')).toBe('400522544');
  });

  it('titleWithBrand prepends when missing', () => {
    expect(titleWithBrand('Note 15', 'Xiaomi')).toBe('Xiaomi Note 15');
    expect(titleWithBrand('Xiaomi Note 15', 'Xiaomi')).toBe('Xiaomi Note 15');
  });

  it('detects OOS phrases', () => {
    expect(isMvideoOutOfStockText('Нет в наличии')).toBe(true);
    expect(isMvideoOutOfStockText('В корзину')).toBe(false);
  });
});

describe('mvideo detect / URL', () => {
  it('detects mvideo.ru and eldorado.ru as mvideo', () => {
    expect(detectMarketplace('https://www.mvideo.ru/products/smartfon-30066712')).toBe('mvideo');
    expect(detectMarketplace('https://www.eldorado.ru/cat/detail/phone-12345/')).toBe('mvideo');
    expect(isProductPage('https://www.mvideo.ru/products/smartfon-30066712')).toBe(true);
    expect(isProductPage('https://www.mvideo.ru/product-list-page?q=iphone')).toBe(false);
  });

  it('canonical keeps host, strips query, prefers www', () => {
    expect(
      toCanonicalProductUrl(
        'https://mvideo.ru/products/smartfon-30066712?utm=1#x',
        'mvideo',
      ),
    ).toBe('https://www.mvideo.ru/products/smartfon-30066712');
    expect(
      toCanonicalProductUrl(
        'https://www.eldorado.ru/cat/detail/phone-123456/?utm=1',
        'mvideo',
      ),
    ).toBe('https://www.eldorado.ru/cat/detail/phone-123456');
  });

  it('extracts article from slug / eldorado item', () => {
    expect(
      extractArticle('https://www.mvideo.ru/products/smartfon-xiaomi-30066712', 'mvideo'),
    ).toBe('30066712');
    expect(extractArticle('https://www.eldorado.ru/item/12345678/', 'mvideo')).toBe('12345678');
  });
});

describe('parseMvideoProduct', () => {
  beforeEach(() => {
    document.documentElement.innerHTML = '';
  });

  it('parses JSON-LD card with preferred price and canonical URL', () => {
    setLocation('https://www.mvideo.ru/products/smartfon-xiaomi-400522544?utm=1');
    document.documentElement.innerHTML = `
      <html><head>
        <script type="application/ld+json">${JSON.stringify({
          '@type': 'Product',
          name: 'Смартфон Xiaomi REDMI Note 15',
          brand: { '@type': 'Brand', name: 'Xiaomi' },
          image: ['//img.mvideo.ru/product-medias/photos/400522544/a.jpg'],
          offers: {
            '@type': 'Offer',
            price: '24990',
            priceCurrency: 'RUB',
            availability: 'https://schema.org/InStock',
          },
          sku: '400522544',
        })}</script>
      </head><body>
        <h1>Смартфон Xiaomi REDMI Note 15</h1>
        <div class="price__main-value">24 990 ₽</div>
      </body></html>
    `;
    const p = parseMvideoProduct();
    expect(p).not.toBeNull();
    expect(p!.marketplace).toBe('mvideo');
    expect(p!.price).toBe(24990);
    expect(p!.article).toBe('400522544');
    expect(p!.url).toBe('https://www.mvideo.ru/products/smartfon-xiaomi-400522544');
    expect(p!.id).toBe('mvideo:400522544');
    expect(p!.imageUrl).toMatch(/^https:\/\//);
    expect(p!.availability).toBe('in_stock');
  });

  it('marks OOS from JSON-LD availability', () => {
    setLocation('https://www.mvideo.ru/products/smartfon-400522544');
    document.documentElement.innerHTML = `
      <html><head>
        <script type="application/ld+json">${JSON.stringify({
          '@type': 'Product',
          name: 'Смартфон тест',
          offers: {
            '@type': 'Offer',
            price: '0',
            availability: 'https://schema.org/OutOfStock',
          },
          sku: '400522544',
        })}</script>
      </head><body><h1>Смартфон тест</h1><div>Нет в наличии</div></body></html>
    `;
    const p = parseMvideoProduct();
    expect(p).not.toBeNull();
    expect(p!.price).toBe(0);
    expect(p!.availability).toBe('out_of_stock');
  });

  it('returns null on SERP (not a product card)', () => {
    setLocation('https://www.mvideo.ru/product-list-page?q=iphone');
    document.documentElement.innerHTML = `<html><body><h1>Поиск</h1></body></html>`;
    expect(parseMvideoProduct()).toBeNull();
  });

  it('parses Eldorado product page as mvideo', () => {
    setLocation('https://www.eldorado.ru/cat/detail/smartfon-12345678/');
    document.documentElement.innerHTML = `
      <html><head>
        <script type="application/ld+json">${JSON.stringify({
          '@type': 'Product',
          name: 'Смартфон Google Pixel',
          offers: { '@type': 'Offer', price: '59990', priceCurrency: 'RUB' },
          sku: '12345678',
        })}</script>
      </head><body><h1>Смартфон Google Pixel</h1></body></html>
    `;
    const p = parseMvideoProduct();
    expect(p).not.toBeNull();
    expect(p!.marketplace).toBe('mvideo');
    expect(p!.price).toBe(59990);
    expect(p!.url).toBe('https://www.eldorado.ru/cat/detail/smartfon-12345678');
  });
});

describe('scrapeMvideoCandidates', () => {
  beforeEach(() => {
    document.documentElement.innerHTML = '';
  });

  it('collects /products/ tiles with canonical URLs and dedupes', () => {
    document.body.innerHTML = `
      <a href="https://www.mvideo.ru/products/phone-111222333/?x=1">
        <h3>Phone A</h3><span>12 000 ₽</span>
      </a>
      <a href="https://www.mvideo.ru/products/phone-111222333/?utm=1">
        <h3>Phone A2</h3><span>11 000 ₽</span>
      </a>
      <a href="https://www.mvideo.ru/products/phone-555666777/">
        <h3>Phone B</h3><span>15 000 ₽</span>
      </a>
      <a href="https://www.mvideo.ru/product-list-page?q=iphone"><h3>Search</h3></a>
    `;
    const c = scrapeMvideoCandidates('iphone');
    expect(c.length).toBe(2);
    expect(c[0]!.url).toBe('https://www.mvideo.ru/products/phone-111222333');
    expect(c.some((x) => x.url.includes('555666777'))).toBe(true);
  });

  it('accepts Eldorado detail hrefs', () => {
    document.body.innerHTML = `
      <a href="https://www.eldorado.ru/cat/detail/phone-999888777/">
        <h3>Phone E</h3><span>9 900 ₽</span>
      </a>
    `;
    const c = scrapeMvideoCandidates('phone');
    expect(c).toHaveLength(1);
    expect(c[0]!.url).toBe('https://www.eldorado.ru/cat/detail/phone-999888777');
  });
});

describe('mvideo SERP junk filter (parity with Mega/Ali)', () => {
  function cand(title: string, id: string, price: number): SearchCandidate {
    return {
      title,
      url: `https://www.mvideo.ru/products/x-${id}`,
      price,
      rating: null,
    };
  }

  it('rejects category-incompatible / zero-score junk', () => {
    const result = pickSearchFromCandidates(
      'mvideo',
      'Смартфон Google Pixel 8',
      'Смартфон Google Pixel 8',
      [
        cand('Диван угловой раскладной', '1000001', 25_000),
        cand('Корм для кошек 2кг', '1000002', 1_200),
      ],
      { referencePrice: 70_000 },
    );
    expect(result.offer.found).toBe(false);
    expect(result.offer.matchStatus === 'not_found' || !result.offer.found).toBe(true);
  });

  it('rejects price outliers vs reference', () => {
    const result = pickSearchFromCandidates(
      'mvideo',
      'Смартфон Google Pixel 8',
      'Смартфон Google Pixel 8',
      [cand('Смартфон Google Pixel 8 128GB', '1000003', 1_999)],
      { referencePrice: 70_000 },
    );
    expect(result.offer.found).toBe(false);
  });
});

describe('mvideo policy (MVIDEO-1…7)', () => {
  it('default-on; not generic card; unlocker on; reviews SKIP; not TEST_MP', () => {
    expect(getMarketplaceEntry('mvideo')?.enabledByDefault).toBe(true);
    expect(getMarketplaceEntry('mvideo')?.capabilities).toEqual({
      search: true,
      card: true,
      reviews: false,
      costTier: 'tab',
    });
    expect(isGenericCardMarketplace('mvideo')).toBe(false);
    expect(isGenericCardMarketplace('dns')).toBe(true);
    expect(isPremiumUnlockerMarketplace('mvideo')).toBe(true);
    expect(isPremiumUnlockerMarketplace('dns')).toBe(false);
  });
});
