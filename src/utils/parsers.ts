import type { Product } from '@/types/product';
import { detectMarketplace, isProductPage } from '@/utils/marketplace';
import { parseRatingFromMarketplaceText } from '@/lib/compare-offers';
import { parseOzonProduct } from '@/utils/parsers/ozon';
import { parseWildberriesProduct } from '@/utils/parsers/wildberries';
import { parseYandexMarketProduct, scrapeYandexMarketSpecs } from '@/utils/parsers/yandex-market';
import { parseMegamarketProduct } from '@/utils/parsers/megamarket';
import { parseAliExpressProduct } from '@/utils/parsers/aliexpress';
import { parseGenericMarketplaceProduct } from '@/utils/parsers/generic-mp-card';
import { isGenericCardMarketplace } from '@/lib/marketplaces/adapter-config';

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

  if (/megamarket\.ru|sbermegamarket\.ru/i.test(url)) {
    return parseMegamarketProduct();
  }

  if (/aliexpress\.ru/i.test(url)) {
    return parseAliExpressProduct();
  }

  const mp = detectMarketplace(url);
  if (mp && isGenericCardMarketplace(mp)) {
    return parseGenericMarketplaceProduct(mp);
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
