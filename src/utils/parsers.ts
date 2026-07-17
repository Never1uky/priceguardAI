import type { Product } from '@/types/product';
import { isProductPage } from '@/utils/marketplace';
import { parseOzonProduct } from '@/utils/parsers/ozon';
import { parseWildberriesProduct } from '@/utils/parsers/wildberries';
import { parseYandexMarketProduct, scrapeYandexMarketSpecs } from '@/utils/parsers/yandex-market';

export { detectMarketplace, isProductPage, buildWildberriesUrl } from '@/utils/marketplace';

export async function scrapeCurrentPage(): Promise<Product | null> {
  if (!isProductPage()) return null;

  const url = window.location.href;
  if (/wildberries\.ru/i.test(url)) {
    return parseWildberriesProduct();
  }

  if (/ozon\.ru/i.test(url)) {
    return parseOzonProduct();
  }

  if (/market\.yandex\.ru/i.test(url)) {
    return parseYandexMarketProduct();
  }

  return null;
}

/** Доп. данные для Яндекс.Маркета (рейтинг, характеристики) */
export function scrapeYandexMeta():
  | { rating: number | null; reviewCount?: number; specs?: string }
  | null {
  if (!/market\.yandex\.ru/i.test(window.location.href)) return null;
  return scrapeYandexMarketSpecs();
}

/** @deprecated используйте scrapeCurrentPage() */
export function scrapeCurrentPageSync(): Product | null {
  if (/ozon\.ru/i.test(window.location.href)) {
    return parseOzonProduct();
  }
  return null;
}
