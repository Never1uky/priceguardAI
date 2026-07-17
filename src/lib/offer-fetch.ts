/**
 * Загрузка оффера с карточки товара — API + фоновая вкладка для коротких ссылок.
 */
import type { ComparisonMarketplace, MarketplaceOffer } from '@/types/comparison';
import { mergeMarketplaceOffers } from '@/lib/compare-offers';
import { fetchOfferWithFallback } from '@/lib/product-page-fetch';
import { detectComparisonMarketplace } from '@/utils/comparison-url';
import { toCanonicalProductUrl } from '@/utils/product-url';

/** Загрузить цену/рейтинг с карточки (WB/Ozon/Я.Маркет). */
export async function fetchOfferFromUrl(
  url: string,
  marketplace: ComparisonMarketplace,
): Promise<MarketplaceOffer | null> {
  try {
    return await fetchOfferWithFallback(url, marketplace);
  } catch {
    return null;
  }
}

/** Обновить оффер данными с карточки. */
export async function enrichOfferFromProductPage(
  offer: MarketplaceOffer,
): Promise<MarketplaceOffer> {
  if (!offer.url) return offer;

  const marketplace = detectComparisonMarketplace(offer.url);
  if (!marketplace) return offer;

  const pageUrl = toCanonicalProductUrl(offer.url, marketplace);
  const fetched = await fetchOfferFromUrl(pageUrl, marketplace);
  if (!fetched?.price || fetched.price <= 0) return offer;

  return mergeMarketplaceOffers(offer, { ...fetched, url: pageUrl, found: true });
}

/** @deprecated Используйте fetchOfferFromUrl */
export async function scrapeProductPageViaTab(url: string): Promise<MarketplaceOffer | null> {
  const marketplace = detectComparisonMarketplace(url);
  if (!marketplace) return null;

  const pageUrl = toCanonicalProductUrl(url, marketplace);
  const offer = await fetchOfferFromUrl(pageUrl, marketplace);
  if (!offer?.price || offer.price <= 0) return null;

  return { ...offer, found: true, url: pageUrl };
}
