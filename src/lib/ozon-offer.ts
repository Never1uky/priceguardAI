import type { MarketplaceOffer } from '@/types/comparison';
import { normalizeMarketplaceRating } from '@/lib/compare-offers';
import { isPromoSerpTitle, sanitizeSerpTitle } from '@/lib/serp-title';
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
  const textAtoms: string[] = [];
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
    if (block.type === 'textAtom' && block.textAtom?.text) {
      textAtoms.push(block.textAtom.text.trim());
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

  for (const atom of textAtoms) {
    if (!isPromoSerpTitle(atom) && (!title || atom.length > title.length)) {
      title = atom;
    }
  }
  title = sanitizeSerpTitle(title, textAtoms.join('\n'));

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
    price?: string | number;
    originalPrice?: string | number;
    cardPrice?: string | number;
    priceV2?: { price?: Array<{ text?: string }> };
    webPrice?: { price?: Array<{ text?: string }> | string; cardPrice?: string };
    atom?: { price?: string; text?: string };
    rating?: number;
    reviewCount?: number;
    totalScore?: number;
    score?: number;
    reviewsCount?: number;
    cellTrackingInfo?: { product?: { id?: number } };
  },
  fallbackUrl: string,
): MarketplaceOffer | null {
  let title = state.title?.trim() ?? '';
  let price = 0;
  let oldPrice: number | undefined;

  const asPrice = (raw: string | number | undefined): number => {
    if (raw == null) return 0;
    if (typeof raw === 'number') return raw > 0 ? Math.round(raw) : 0;
    return parseInt(String(raw).replace(/\D/g, ''), 10) || 0;
  };

  price = asPrice(state.price) || asPrice(state.cardPrice);
  oldPrice = asPrice(state.originalPrice) || undefined;

  if (!price && state.priceV2?.price?.length) {
    const prices = state.priceV2.price
      .map((p) => asPrice(p.text))
      .filter((n) => n > 0);
    const breakdown = ozonPricesFromNumbers(prices);
    if (breakdown) {
      const normalized = ozonBreakdownToOfferPrices(breakdown);
      price = normalized.price;
      oldPrice = normalized.oldPrice;
    }
  }

  if (!price && state.webPrice) {
    if (typeof state.webPrice.price === 'string') {
      price = asPrice(state.webPrice.price);
    } else if (Array.isArray(state.webPrice.price)) {
      const prices = state.webPrice.price
        .map((p) => asPrice(p.text))
        .filter((n) => n > 0);
      const breakdown = ozonPricesFromNumbers(prices);
      if (breakdown) {
        const normalized = ozonBreakdownToOfferPrices(breakdown);
        price = normalized.price;
        oldPrice = normalized.oldPrice ?? oldPrice;
      }
    }
    if (!price) price = asPrice(state.webPrice.cardPrice);
  }

  if (!price && state.atom?.price) {
    price = asPrice(state.atom.price);
  }
  if (!title && state.atom?.text) {
    title = state.atom.text.trim();
  }

  if (!price) return null;

  const rating =
    state.rating ??
    state.totalScore ??
    state.score ??
    null;

  const reviewCount = state.reviewCount ?? state.reviewsCount;

  return {
    marketplace: 'ozon',
    title: title || 'Товар на Ozon',
    price,
    oldPrice: oldPrice && oldPrice > price ? oldPrice : undefined,
    delivery: null,
    rating: normalizeMarketplaceRating(rating),
    reviewCount,
    url: fallbackUrl,
    found: true,
  };
}

/** Deep-scan widget JSON for title + price when flat product widget is missing. */
function extractOfferFromWidgetTree(
  value: unknown,
  fallbackUrl: string,
  depth = 0,
): MarketplaceOffer | null {
  if (depth > 8 || value == null) return null;

  if (typeof value === 'string') {
    try {
      return extractOfferFromWidgetTree(JSON.parse(value), fallbackUrl, depth + 1);
    } catch {
      return null;
    }
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = extractOfferFromWidgetTree(item, fallbackUrl, depth + 1);
      if (found) return found;
    }
    return null;
  }

  if (typeof value !== 'object') return null;
  const obj = value as Record<string, unknown>;

  const direct = parseOzonProductPageState(
    obj as Parameters<typeof parseOzonProductPageState>[0],
    fallbackUrl,
  );
  if (direct && direct.price != null && direct.price > 0) return direct;

  for (const child of Object.values(obj)) {
    if (child && typeof child === 'object') {
      const found = extractOfferFromWidgetTree(child, fallbackUrl, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function extractOzonSkuFromUrl(url: string): string | null {
  const match = url.match(/\/product\/[^/?#]+-(\d+)/i) ?? url.match(/\/product\/(\d+)/i);
  return match?.[1] ?? null;
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
        price?: string | number;
        originalPrice?: string | number;
        rating?: number;
        reviewCount?: number;
        totalScore?: number;
        score?: number;
        reviewsCount?: number;
      };

      if (state.title || state.price || /webPrice|webSale|product/i.test(key)) {
        const offer = parseOzonProductPageState(state, fallbackUrl);
        if (offer) productOffer = offer;
      }

      if (!productOffer && /webPrice|webSale|pdp|productHeading|webProduct/i.test(key)) {
        const deep = extractOfferFromWidgetTree(state, fallbackUrl);
        if (deep) productOffer = deep;
      }

      for (const item of state.items ?? []) {
        const offer = parseOzonItemState(item);
        if (offer) searchOffers.push(offer);
      }
    } catch {
      // continue
    }
  }

  if (!productOffer) {
    for (const raw of Object.values(widgetStates)) {
      const deep = extractOfferFromWidgetTree(raw, fallbackUrl);
      if (deep) {
        productOffer = deep;
        break;
      }
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
  const canonical = (() => {
    try {
      const parsed = new URL(url);
      return `${parsed.origin}${parsed.pathname}`;
    } catch {
      return url.split('?')[0].split('#')[0];
    }
  })();

  const path = new URL(canonical).pathname.replace(/\/$/, '') || '/';
  const sku = extractOzonSkuFromUrl(canonical);
  const pathCandidates = [
    path,
    path.endsWith('/') ? path : `${path}/`,
    sku ? `/product/${sku}` : null,
    sku ? `/product/${sku}/` : null,
  ].filter((p, i, arr): p is string => Boolean(p) && arr.indexOf(p) === i);

  const tryPaths = async (timeoutMs: number): Promise<MarketplaceOffer | null> => {
    for (const candidatePath of pathCandidates) {
      const apiUrl =
        `https://www.ozon.ru/api/composer-api.bx/page/json/v2` +
        `?url=${encodeURIComponent(candidatePath)}`;

      try {
        const response = await fetchWithRetry(
          apiUrl,
          {
            headers: {
              Accept: 'application/json',
              'Accept-Language': 'ru-RU,ru;q=0.9',
            },
          },
          { timeoutMs },
        );
        if (!response.ok) continue;

        const data = (await response.json()) as { widgetStates?: Record<string, string> };
        if (!data.widgetStates || Object.keys(data.widgetStates).length === 0) continue;
        const offer = parseOzonWidgetStates(data.widgetStates, canonical);
        if (offer?.price && offer.price > 0) return offer;
      } catch {
        // try next path
      }
    }
    return null;
  };

  const first = await tryPaths(10_000);
  if (first) return first;

  // Soft hydrate / slow composer — one longer timeout pass
  return tryPaths(20_000);
}
