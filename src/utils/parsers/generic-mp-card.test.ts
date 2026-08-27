/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from 'vitest';
import {
  normalizeImageCandidate,
  parseGenericMarketplaceProduct,
  parseImageFromDomRoot,
  pickBestCardPrice,
} from '@/utils/parsers/generic-mp-card';

describe('generic-mp image/price helpers', () => {
  it('normalizeImageCandidate accepts protocol-relative and rejects junk', () => {
    expect(normalizeImageCandidate('//cdn.example/p.jpg')).toBe('https://cdn.example/p.jpg');
    expect(normalizeImageCandidate('https://cdn.example/product.webp')).toContain('https://');
    expect(normalizeImageCandidate('data:image/svg+xml,x')).toBeNull();
    expect(normalizeImageCandidate('https://x/pixel.gif')).toBeNull();
  });

  it('pickBestCardPrice ignores tiny junk; prefers sale over strikethrough', () => {
    expect(pickBestCardPrice([6, 4.5, 24990])).toBe(24990);
    expect(pickBestCardPrice([6, 12])).toBeNull();
    expect(pickBestCardPrice([20990, 21990, 6])).toBe(20990);
  });

  it('scores product CDN images above banners/logos', async () => {
    const { scoreProductImageUrl } = await import('./generic-mp-card');
    const product =
      'https://img.mvideo.ru/product-medias/photos/400522544/abc.jpg?width=400';
    const banner = 'https://cdn.citilink.ru/x/resizing_type:fit/width:1920/height:80/plain/banners/nw_banne';
    const logo = 'https://cms.mvideo.ru/magnoliaPublic/dam/logo';
    expect(scoreProductImageUrl(product)).toBeGreaterThan(scoreProductImageUrl(banner));
    expect(normalizeImageCandidate(logo)).toBeNull();
  });

  it('parses og:image //cdn and JSON-LD price over body junk', () => {
    document.documentElement.innerHTML = `
      <html><head>
        <meta property="og:image" content="//a.lmcdn.ru/img/product.jpg" />
        <script type="application/ld+json">${JSON.stringify({
          '@type': 'Product',
          name: 'Смартфон Xiaomi REDMI Note 15',
          image: ['//cdn.mvideo.ru/big.jpg', 'https://cdn.mvideo.ru/big2.jpg'],
          offers: { '@type': 'Offer', price: '24990', priceCurrency: 'RUB' },
          sku: '400522544',
        })}</script>
      </head><body>
        <h1>Смартфон Xiaomi REDMI Note 15</h1>
        <div>Рейтинг 6</div>
        <div>Бонусы 6 ₽</div>
      </body></html>
    `;
    // Fake mvideo product URL for isProductPage
    Object.defineProperty(window, 'location', {
      value: new URL('https://www.mvideo.ru/products/smartfon-xiaomi-400522544'),
      writable: true,
    });
    const product = parseGenericMarketplaceProduct('mvideo');
    expect(product).not.toBeNull();
    expect(product!.price).toBe(24990);
    expect(product!.imageUrl).toMatch(/^https:\/\//);
    expect(parseImageFromDomRoot(document)).toMatch(/^https:\/\//);
  });
});
