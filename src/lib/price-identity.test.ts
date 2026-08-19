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
});
