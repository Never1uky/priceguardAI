/**
 * Загрузка оффера с карточки товара — API + фоновая вкладка для коротких ссылок.
 */
import type { ComparisonMarketplace, MarketplaceOffer } from '@/types/comparison';
import { mergeMarketplaceOffers } from '@/lib/compare-offers';
import { fetchOfferWithFallback, type FetchOfferOptions } from '@/lib/product-page-fetch';
import { isOutOfStockError, OUT_OF_STOCK_ERROR } from '@/lib/out-of-stock';
import { detectComparisonMarketplace } from '@/utils/comparison-url';
import { toCanonicalProductUrl } from '@/utils/product-url';

const NO_PRICE_ERROR = 'Товар не найден — добавьте прямую ссылку на карточку';

/** Загрузить цену/рейтинг с карточки (WB/Ozon/Я.Маркет). */
export async function fetchOfferFromUrl(
  url: string,
  marketplace: ComparisonMarketplace,
  options?: FetchOfferOptions,
): Promise<MarketplaceOffer | null> {
  try {
    return await fetchOfferWithFallback(url, marketplace, options);
  } catch (error) {
    // Re-throw network-ish errors for pick retry; swallow soft failures
    const msg = error instanceof Error ? error.message.toLowerCase() : '';
    if (
      msg.includes('network') ||
      msg.includes('failed to fetch') ||
      msg.includes('timeout') ||
      msg.includes('aborted')
    ) {
      throw error;
    }
    return null;
  }
}

function clearPricedFields(offer: MarketplaceOffer, pageUrl: string): MarketplaceOffer {
  return {
    ...offer,
    url: pageUrl,
    price: null,
    found: false,
    needsManualPick: false,
  };
}

/** Обновить оффер данными с карточки. */
export async function enrichOfferFromProductPage(
  offer: MarketplaceOffer,
  options?: FetchOfferOptions,
): Promise<MarketplaceOffer> {
  if (!offer.url) return offer;

  const marketplace = detectComparisonMarketplace(offer.url);
  if (!marketplace) return offer;

  const pageUrl = toCanonicalProductUrl(offer.url, marketplace);
  const fetched = await fetchOfferFromUrl(pageUrl, marketplace, options);

  if (!fetched) {
    return clearPricedFields(
      {
        ...offer,
        matchStatus: 'not_found',
        error: NO_PRICE_ERROR,
      },
      pageUrl,
    );
  }

  if (isOutOfStockError(fetched.error) || fetched.matchStatus === 'oos') {
    return mergeMarketplaceOffers(
      offer,
      clearPricedFields(
        {
          ...fetched,
          matchStatus: 'oos',
          error: fetched.error?.trim() || OUT_OF_STOCK_ERROR,
        },
        pageUrl,
      ),
    );
  }

  if (!fetched.price || fetched.price <= 0) {
    const oos = isOutOfStockError(fetched.error);
    return mergeMarketplaceOffers(
      offer,
      clearPricedFields(
        {
          ...fetched,
          matchStatus: oos ? 'oos' : 'not_found',
          error: fetched.error?.trim() || (oos ? OUT_OF_STOCK_ERROR : NO_PRICE_ERROR),
        },
        pageUrl,
      ),
    );
  }

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
