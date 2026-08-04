import type { Product } from '@/types/product';
import { isProductPage } from '@/utils/marketplace';
import { parseRatingFromMarketplaceText } from '@/lib/compare-offers';
import { parseOzonProduct } from '@/utils/parsers/ozon';
import { parseWildberriesProduct } from '@/utils/parsers/wildberries';
import { parseYandexMarketProduct, scrapeYandexMarketSpecs } from '@/utils/parsers/yandex-market';

export { detectMarketplace, isProductPage, buildWildberriesUrl } from '@/utils/marketplace';

export type PageOfferMeta = {
  rating: number | null;
  reviewCount?: number;
  specs?: string;
};

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

/** Доп. данные карточки: рейтинг (и specs на YM) для MarketplaceOffer */
export function scrapeProductPageMeta(): PageOfferMeta | null {
  if (!isProductPage()) return null;

  const url = window.location.href;
  if (/market\.yandex\.ru/i.test(url)) {
    return scrapeYandexMarketSpecs();
  }

  // WB / Ozon: рейтинг из видимого текста карточки (API-путь обычно уже с rating)
  const { rating, reviewCount } = parseRatingFromMarketplaceText(
    document.body?.textContent ?? '',
  );
  if (rating == null && reviewCount == null) return null;
  return { rating, reviewCount };
}

/** @deprecated use scrapeProductPageMeta */
export function scrapeYandexMeta(): PageOfferMeta | null {
  return scrapeProductPageMeta();
}

/** @deprecated используйте scrapeCurrentPage() */
export function scrapeCurrentPageSync(): Product | null {
  if (/ozon\.ru/i.test(window.location.href)) {
    return parseOzonProduct();
  }
  return null;
}
