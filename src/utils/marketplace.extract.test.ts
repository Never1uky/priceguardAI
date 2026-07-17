import { describe, expect, it } from 'vitest';
import { extractArticle } from '@/utils/marketplace';

describe('extractArticle', () => {
  describe('wildberries', () => {
    it('takes nmId from /catalog/{id}/ path segment (not affected by query)', () => {
      expect(
        extractArticle(
          'https://www.wildberries.ru/catalog/217753044/detail.aspx?targetUrl=GP',
          'wildberries',
        ),
      ).toBe('217753044');
      expect(
        extractArticle(
          'https://www.wildberries.ru/catalog/217753044/feedbacks',
          'wildberries',
        ),
      ).toBe('217753044');
    });
  });

  describe('yandex_market', () => {
    it('takes id after /card/{slug}/ even if slug has numbers', () => {
      expect(
        extractArticle(
          'https://market.yandex.ru/card/noski-gsd-belyy-rus-4346-orig-43-46/103215965470?cpc=x',
          'yandex_market',
        ),
      ).toBe('103215965470');
    });

    it('supports /product/{id} and /product--slug/{id}', () => {
      expect(
        extractArticle('https://market.yandex.ru/product/103215965470', 'yandex_market'),
      ).toBe('103215965470');
      expect(
        extractArticle(
          'https://market.yandex.ru/product--noski-4346/103215965470',
          'yandex_market',
        ),
      ).toBe('103215965470');
    });
  });

  describe('ozon', () => {
    it('uses last long id in slug (not model code like 98101)', () => {
      expect(
        extractArticle(
          'https://www.ozon.ru/product/kastryulya-taller-tr-98101-2l-1435731950/',
          'ozon',
        ),
      ).toBe('1435731950');
    });
  });
});
