import { describe, expect, it } from 'vitest';
import {
  isStableArticle,
  isLiveProductInTrackedList,
  isSuspiciousIdentityDrop,
  productsIdentityMatch,
  resolveProductArticle,
  stableProductStorageId,
} from '@/lib/price-identity';

describe('price-identity', () => {
  it('matches same WB article + URL', () => {
    const tracked = {
      marketplace: 'wildberries' as const,
      article: '12345678',
      url: 'https://www.wildberries.ru/catalog/12345678/detail.aspx',
      id: 'wb-12345678',
      title: 'Realme 16',
    };
    const scraped = {
      marketplace: 'wildberries' as const,
      article: '12345678',
      url: 'https://www.wildberries.ru/catalog/12345678/detail.aspx?targetUrl=GP',
      id: 'wb-12345678',
      title: 'Realme 16',
    };
    expect(productsIdentityMatch(tracked, scraped).ok).toBe(true);
  });

  it('rejects different article with similar title', () => {
    const tracked = {
      marketplace: 'wildberries' as const,
      article: '11111111',
      url: 'https://www.wildberries.ru/catalog/11111111/detail.aspx',
      id: 'wb-11111111',
      title: 'Смартфон Realme 16 8/256',
    };
    const scraped = {
      marketplace: 'wildberries' as const,
      article: '22222222',
      url: 'https://www.wildberries.ru/catalog/22222222/detail.aspx',
      id: 'wb-22222222',
      title: 'Смартфон Xiaomi Redmi 15C',
    };
    const match = productsIdentityMatch(tracked, scraped);
    expect(match.ok).toBe(false);
    if (!match.ok) expect(match.reason).toBe('article_mismatch');
  });

  it('rejects unstable empty / placeholder articles', () => {
    expect(isStableArticle('')).toBe(false);
    expect(isStableArticle('ym')).toBe(false);
    expect(isStableArticle('12345')).toBe(true);
    expect(stableProductStorageId({
      marketplace: 'yandex_market',
      article: 'ym',
      url: 'https://market.yandex.ru/',
      id: 'yandex-ym',
    })).toBeNull();
  });

  it('resolves article from canonical URL when field empty', () => {
    expect(
      resolveProductArticle({
        marketplace: 'ozon',
        article: '',
        url: 'https://www.ozon.ru/product/smartfon-xiaomi-1234567890/',
        id: 'ozon-x',
      }),
    ).toBe('1234567890');
  });

  it('flags huge drop without identity as suspicious', () => {
    expect(isSuspiciousIdentityDrop(25_000, 14_939, false)).toBe(true);
    expect(isSuspiciousIdentityDrop(25_000, 14_939, true)).toBe(false);
    expect(isSuspiciousIdentityDrop(15_000, 14_500, false)).toBe(false);
  });

  it('SPA stale cache: different YM cards do not match', () => {
    const realme = {
      marketplace: 'yandex_market' as const,
      article: '5001111111',
      url: 'https://market.yandex.ru/card/realme-16/5001111111',
      id: 'yandex-5001111111',
      title: 'Realme 16',
    };
    const xiaomi = {
      marketplace: 'yandex_market' as const,
      article: '5002222222',
      url: 'https://market.yandex.ru/card/xiaomi-redmi-15c/5002222222',
      id: 'yandex-5002222222',
      title: 'Xiaomi Redmi 15C',
      price: 14939,
    };
    expect(productsIdentityMatch(realme, xiaomi).ok).toBe(false);
    expect(stableProductStorageId(realme)).toBe('yandex-5001111111');
    expect(stableProductStorageId(xiaomi)).toBe('yandex-5002222222');
  });

  it('isLiveProductInTrackedList matches by article when ids differ', () => {
    const tracked = [
      {
        marketplace: 'wildberries' as const,
        article: '741076063',
        url: 'https://www.wildberries.ru/catalog/741076063/detail.aspx',
        id: 'wb-741076063',
        title: 'Sony WH-1000XM5',
      },
    ];
    const live = {
      marketplace: 'wildberries' as const,
      article: '741076063',
      url: 'https://www.wildberries.ru/catalog/741076063/detail.aspx',
      id: 'scraped-wb-741076063',
      title: 'Sony WH-1000XM5',
    };
    expect(isLiveProductInTrackedList(live, tracked)).toBe(true);
  });

  it('megamarket uses mm- storage id and strips megamarket: / URL slug', () => {
    expect(
      resolveProductArticle({
        marketplace: 'megamarket',
        article: '',
        url: 'https://megamarket.ru/catalog/details/smartfon-100067205836/',
        id: 'megamarket:x',
      }),
    ).toBe('100067205836');
    expect(
      stableProductStorageId({
        marketplace: 'megamarket',
        article: '100067205836',
        url: 'https://megamarket.ru/catalog/details/100067205836/',
        id: 'megamarket:100067205836',
      }),
    ).toBe('mm-100067205836');
    expect(
      productsIdentityMatch(
        {
          marketplace: 'megamarket',
          article: '100067205836',
          url: 'https://megamarket.ru/catalog/details/smartfon-100067205836/',
          id: 'mm-100067205836',
        },
        {
          marketplace: 'megamarket',
          article: '100067205836',
          url: 'https://megamarket.ru/catalog/details/100067205836/?ref=1',
          id: 'megamarket:100067205836',
        },
      ).ok,
    ).toBe(true);
  });

  it('aliexpress uses ae- storage id and strips aliexpress: / item URL', () => {
    expect(
      resolveProductArticle({
        marketplace: 'aliexpress',
        article: '',
        url: 'https://aliexpress.ru/item/1005001234567890.html?spm=x',
        id: 'aliexpress:x',
      }),
    ).toBe('1005001234567890');
    expect(
      stableProductStorageId({
        marketplace: 'aliexpress',
        article: '1005001234567890',
        url: 'https://aliexpress.ru/item/1005001234567890.html',
        id: 'aliexpress:1005001234567890',
      }),
    ).toBe('ae-1005001234567890');
    expect(
      productsIdentityMatch(
        {
          marketplace: 'aliexpress',
          article: '1005001234567890',
          url: 'https://aliexpress.ru/item/1005001234567890.html',
        },
        {
          marketplace: 'aliexpress',
          id: 'ae-1005001234567890',
          url: 'https://aliexpress.ru/item/1005001234567890.html',
        },
      ).ok,
    ).toBe(true);
  });

  it('mvideo uses mv- storage id and strips mvideo: / products URL', () => {
    expect(
      resolveProductArticle({
        marketplace: 'mvideo',
        article: '',
        url: 'https://www.mvideo.ru/products/smartfon-30066712?utm=1',
        id: 'mvideo:x',
      }),
    ).toBe('30066712');
    expect(
      stableProductStorageId({
        marketplace: 'mvideo',
        article: '30066712',
        url: 'https://www.mvideo.ru/products/smartfon-30066712',
        id: 'mvideo:30066712',
      }),
    ).toBe('mv-30066712');
    expect(
      productsIdentityMatch(
        {
          marketplace: 'mvideo',
          article: '30066712',
          url: 'https://www.mvideo.ru/products/smartfon-30066712',
        },
        {
          marketplace: 'mvideo',
          id: 'mv-30066712',
          url: 'https://www.eldorado.ru/cat/detail/phone-30066712/',
        },
      ).ok,
    ).toBe(true);
  });
});
