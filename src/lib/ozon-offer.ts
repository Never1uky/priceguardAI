import type { MarketplaceOffer } from '@/types/comparison';
import { normalizeMarketplaceRating } from '@/lib/compare-offers';
import { fetchWithRetry } from '@/lib/fetch-retry';
import {
  ozonBreakdownToOfferPrices,
  ozonPricesFromNumbers,
} from '@/lib/ozon-prices';
import { isProductPageUrl } from '@/lib/product-match';

type OzonSearchItem = {
  action?: { link?: string };
  link?: string;
  deeplink?: string;
  deepLink?: string;
  webLink?: string;
  mainState?: Array<{
    type?: string;
    priceV2?: { price?: Array<{ text?: string }> };
    textAtom?: { text?: string };
    labelList?: { items?: Array<{ title?: string }> };
    rating?: { totalScore?: number; count?: string };
  }>;
  cellTrackingInfo?: { click?: { link?: string }; link?: string };
};

/** Достать URL карточки из элемента выдачи (не SERP). */
function extractOzonProductLink(item: OzonSearchItem): string | null {
  const candidates = [
    item.action?.link,
    item.link,
    item.webLink,
    item.deeplink,
    item.deepLink,
    item.cellTrackingInfo?.click?.link,
    item.cellTrackingInfo?.link,
  ];

  for (const raw of candidates) {
    if (!raw || typeof raw !== 'string') continue;
    const href = raw.startsWith('http') ? raw : `https://www.ozon.ru${raw.startsWith('/') ? raw : `/${raw}`}`;
    // Ozon deep links can be ozon://product/... — extract product path if present
    const productPath = href.match(/(\/product\/[^?\s#]+)/i)?.[1];
    if (productPath) {
      const url = `https://www.ozon.ru${productPath}`;
      if (isProductPageUrl(url)) return url;
    }
    if (isProductPageUrl(href)) return href;
  }
  return null;
}

function parseOzonItemState(item: OzonSearchItem): MarketplaceOffer | null {
  let title = '';
  let price = 0;
  let oldPrice: number | undefined;
  let basePrice: number | undefined;
  let payPrice: number | undefined;
  let rating: number | null = null;
  let reviewCount: number | undefined;
  let delivery: string | null = null;
  const link = extractOzonProductLink(item);

  // Без ссылки на карточку — не подставляем /search/?text=… (это ломает сравнение)
  if (!link) return null;

  for (const block of item.mainState ?? []) {
    if (block.type === 'textAtom' && block.textAtom?.text && !title) {
      title = block.textAtom.text;
    }
    if (block.type === 'priceV2' && block.priceV2?.price?.length) {
      const prices = block.priceV2.price
        .map((p) => parseInt((p.text ?? '').replace(/\D/g, ''), 10))
        .filter((n) => n > 0);
      if (prices.length) {
        const breakdown = ozonPricesFromNumbers(prices);
        if (breakdown) {
          const normalized = ozonBreakdownToOfferPrices(breakdown);
          price = normalized.price;
          oldPrice = normalized.oldPrice;
          basePrice = normalized.basePrice;
          payPrice = normalized.payPrice;
        }
      }
    }
    if (block.type === 'rating' && block.rating?.totalScore) {
      rating = normalizeMarketplaceRating(block.rating.totalScore);
      const count = parseInt((block.rating.count ?? '').replace(/\D/g, ''), 10);
      if (count) reviewCount = count;
    }
    if (block.type === 'labelList') {
      const deliveryLabel = block.labelList?.items?.find((i) =>
        /доставк|завтра|дн/i.test(i.title ?? ''),
      );
      if (deliveryLabel?.title) delivery = deliveryLabel.title;
    }
  }

  if (!price) return null;

  return {
    marketplace: 'ozon',
    title: title || 'Товар на Ozon',
    price,
    oldPrice: oldPrice && oldPrice > price ? oldPrice : undefined,
    basePrice,
    payPrice,
    delivery,
    rating,
    reviewCount,
    url: link,
    found: true,
  };
}

function parseOzonProductPageState(
  state: {
    title?: string;
    price?: string;
    originalPrice?: string;
    rating?: number;
    reviewCount?: number;
    totalScore?: number;
    score?: number;
    reviewsCount?: number;
    cellTrackingInfo?: { product?: { id?: number } };
  },
  fallbackUrl: string,
): MarketplaceOffer | null {
  if (!state.title || !state.price) return null;

  const price = parseInt(state.price.replace(/\D/g, ''), 10);
  const oldPrice = state.originalPrice
    ? parseInt(state.originalPrice.replace(/\D/g, ''), 10)
    : undefined;

  if (!price) return null;

  const rating =
    state.rating ??
    state.totalScore ??
    state.score ??
    null;

  const reviewCount = state.reviewCount ?? state.reviewsCount;

  return {
    marketplace: 'ozon',
    title: state.title,
    price,
    oldPrice: oldPrice && oldPrice > price ? oldPrice : undefined,
    delivery: null,
    rating: normalizeMarketplaceRating(rating),
    reviewCount,
    url: fallbackUrl,
    found: true,
  };
}

function parseOzonRatingWidget(raw: string): { rating: number | null; reviewCount?: number } {
  try {
    const state = JSON.parse(raw) as {
      totalScore?: number;
      score?: number;
      rating?: number;
      count?: string;
      reviewsCount?: number;
    };

    const rating = state.totalScore ?? state.score ?? state.rating ?? null;
    const reviewCount =
      state.reviewsCount ??
      (state.count ? parseInt(state.count.replace(/\D/g, ''), 10) : undefined);

    return {
      rating: normalizeMarketplaceRating(rating),
      reviewCount: reviewCount && reviewCount > 0 ? reviewCount : undefined,
    };
  } catch {
    return { rating: null };
  }
}

export function parseOzonWidgetStates(
  widgetStates: Record<string, string>,
  fallbackUrl: string,
): MarketplaceOffer | null {
  let productOffer: MarketplaceOffer | null = null;
  let searchOffers: MarketplaceOffer[] = [];
  let pageRating: { rating: number | null; reviewCount?: number } = { rating: null };

  for (const [key, raw] of Object.entries(widgetStates)) {
    if (/rating|review|score/i.test(key)) {
      const parsed = parseOzonRatingWidget(raw);
      if (parsed.rating) pageRating = parsed;
    }

    try {
      const state = JSON.parse(raw) as {
        items?: Array<Parameters<typeof parseOzonItemState>[0]>;
        title?: string;
        price?: string;
        originalPrice?: string;
        rating?: number;
        reviewCount?: number;
        totalScore?: number;
        score?: number;
        reviewsCount?: number;
      };

      if (state.title && state.price) {
        const offer = parseOzonProductPageState(state, fallbackUrl);
        if (offer) productOffer = offer;
      }

      for (const item of state.items ?? []) {
        const offer = parseOzonItemState(item);
        if (offer) searchOffers.push(offer);
      }
    } catch {
      // continue
    }
  }

  if (productOffer) {
    return {
      ...productOffer,
      rating: normalizeMarketplaceRating(productOffer.rating ?? pageRating.rating),
      reviewCount: productOffer.reviewCount ?? pageRating.reviewCount,
    };
  }

  return searchOffers[0] ?? null;
}

export function parseAllOzonSearchOffers(
  widgetStates: Record<string, string>,
  _fallbackUrl?: string,
): MarketplaceOffer[] {
  const offers: MarketplaceOffer[] = [];

  for (const raw of Object.values(widgetStates)) {
    try {
      const state = JSON.parse(raw) as {
        items?: Array<Parameters<typeof parseOzonItemState>[0]>;
      };

      for (const item of state.items ?? []) {
        const offer = parseOzonItemState(item);
        if (offer) offers.push(offer);
      }
    } catch {
      // continue
    }
  }

  return offers;
}

export async function fetchOzonOfferFromPage(url: string): Promise<MarketplaceOffer | null> {
  const path = new URL(url).pathname;
  const apiUrl =
    `https://www.ozon.ru/api/composer-api.bx/page/json/v2` +
    `?url=${encodeURIComponent(path)}`;

  const response = await fetchWithRetry(apiUrl, {
    headers: {
      Accept: 'application/json',
      'Accept-Language': 'ru-RU,ru;q=0.9',
    },
  });
  if (!response.ok) return null;

  const data = (await response.json()) as { widgetStates?: Record<string, string> };
  return data.widgetStates ? parseOzonWidgetStates(data.widgetStates, url) : null;
}
