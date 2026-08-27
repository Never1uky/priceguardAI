/**
 * Парсинг ссылок WB / Ozon / Яндекс.Маркет для Telegram-бота.
 */

export type Marketplace =
  | 'wildberries'
  | 'ozon'
  | 'yandex_market'
  | 'megamarket'
  | 'aliexpress';

export interface ParsedProductLink {
  marketplace: Marketplace;
  productId: string;
  /** Каноничный URL карточки (для YM — /card/slug/id без query) */
  url: string;
  /** Черновик названия из slug (YM card) */
  titleHint?: string;
}

const URL_RE = /https?:\/\/[^\s<>"']+/gi;

export function extractUrls(text: string): string[] {
  const matches = text.match(URL_RE) ?? [];
  return matches.map((u) => u.replace(/[.,;!?)]+$/g, ''));
}

export function detectMarketplace(url: string): Marketplace | null {
  if (/wildberries\.ru/i.test(url)) return 'wildberries';
  if (/ozon\.ru/i.test(url)) return 'ozon';
  if (/market\.yandex\.ru/i.test(url)) return 'yandex_market';
  if (/megamarket\.ru|sbermegamarket\.ru/i.test(url)) return 'megamarket';
  if (/aliexpress\.ru/i.test(url)) return 'aliexpress';
  return null;
}

export function extractProductId(url: string, marketplace: Marketplace): string {
  switch (marketplace) {
    case 'wildberries': {
      // /catalog/{nmId}/… — id отдельный сегмент
      const m = url.match(/\/catalog\/(\d+)/i);
      return m?.[1] ?? '';
    }
    case 'ozon': {
      // Берём ПОСЛЕДНИЙ длинный id в сегменте /product/... —
      // иначе из «…-tr-98101-2l-1435731950» ошибочно берётся 98101.
      const seg = url.match(/\/product\/([^/?#]+)/i)?.[1] ?? '';
      const ids = [...seg.matchAll(/(\d{5,})/g)].map((m) => m[1]);
      if (ids.length) return ids[ids.length - 1]!;
      const idPath = url.match(/\/id\/(\d+)/i);
      if (idPath?.[1]) return idPath[1];
      const context = url.match(/\/context\/detail\/id\/(\d+)/i);
      return context?.[1] ?? '';
    }
    case 'yandex_market': {
      // /card/{slug}/{id} — id после slug; цифры в slug не считаются id
      const card = url.match(/\/card\/[^/]+\/(\d+)/i);
      if (card?.[1]) return card[1];
      const product = url.match(/\/product(?:--[^/]+)?\/(\d+)/i);
      return product?.[1] ?? '';
    }
    case 'megamarket': {
      const fromSlug = url.match(/\/catalog\/details\/[^/?#]*?(\d{6,})\/?(?:[?#]|$)/i)?.[1];
      if (fromSlug) return fromSlug;
      return url.match(/\/catalog\/details\/(\d{6,})\/?/i)?.[1] ?? '';
    }
    case 'aliexpress': {
      return url.match(/\/item\/(\d{8,})(?:\.html)?/i)?.[1] ?? '';
    }
    default:
      return '';
  }
}

/** Черновик названия из slug Ozon /product/name-id */
export function titleHintFromOzonUrl(url: string): string | undefined {
  try {
    const seg = new URL(url).pathname.match(/\/product\/([^/?#]+)/i)?.[1];
    if (!seg) return undefined;
    const withoutId = seg.replace(/-?\d{5,}$/u, '').replace(/[-_]+/g, ' ').trim();
    if (!withoutId || withoutId.length < 3) return undefined;
    return withoutId.replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 160);
  } catch {
    return undefined;
  }
}

/** Заголовок из /card/{slug}/{id} */
export function titleHintFromYmUrl(url: string): string | undefined {
  try {
    const path = new URL(url).pathname;
    const m = path.match(/\/card\/([^/]+)\//i);
    if (!m?.[1]) return undefined;
    const raw = decodeURIComponent(m[1]).replace(/[-_]+/g, ' ').trim();
    if (!raw) return undefined;
    return raw.replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 160);
  } catch {
    return undefined;
  }
}

/**
 * Нормализация URL для хранения/кнопки.
 * YM: не превращать /card/slug/id в /product/id — так карточка и цена живут на Маркете.
 */
export function normalizeStoredProductUrl(
  raw: string,
  marketplace: Marketplace,
  productId: string,
): string {
  try {
    const u = new URL(raw.trim());
    u.hash = '';

    if (marketplace === 'wildberries') {
      return `https://www.wildberries.ru/catalog/${productId}/detail.aspx`;
    }

    if (marketplace === 'ozon') {
      u.search = '';
      const path = u.pathname.replace(/\/$/, '');
      // Сохраняем полный /product/slug-id/ — короткий /product/id/ хуже отдаёт composer API
      if (/\/product\/[^/]+/i.test(path)) {
        return `https://www.ozon.ru${path}/`;
      }
      if (/\/context\/detail\/id\/(\d+)/i.test(path)) {
        return `https://www.ozon.ru/product/${productId}/`;
      }
      return `https://www.ozon.ru/product/${productId}/`;
    }

    if (marketplace === 'megamarket') {
      u.search = '';
      const path = u.pathname.replace(/\/$/, '');
      const host = /sbermegamarket\.ru/i.test(u.hostname)
        ? 'https://megamarket.ru'
        : `${u.protocol}//${u.hostname}`;
      if (/\/catalog\/details\//i.test(path)) {
        return `${host}${path}`;
      }
      return `${host}/catalog/details/${productId}`;
    }

    if (marketplace === 'aliexpress') {
      const id = productId.replace(/\D/g, '') || productId;
      return `https://aliexpress.ru/item/${id}.html`;
    }

    // yandex_market
    u.search = '';
    const path = u.pathname.replace(/\/$/, '');
    if (/\/card\/[^/]+\/\d+/i.test(path)) {
      return `${u.origin}${path}`;
    }
    if (/\/product(?:--[^/]+)?\/\d+/i.test(path)) {
      return `${u.origin}${path}`;
    }
    return `${u.origin}${path || `/product/${productId}`}`;
  } catch {
    return reconstructFallbackUrl(marketplace, productId);
  }
}

export function reconstructFallbackUrl(marketplace: Marketplace, productId: string): string {
  if (marketplace === 'wildberries') {
    return `https://www.wildberries.ru/catalog/${productId}/detail.aspx`;
  }
  if (marketplace === 'ozon') {
    return `https://www.ozon.ru/product/${productId}/`;
  }
  if (marketplace === 'megamarket') {
    const id = productId.replace(/\D/g, '') || productId;
    return `https://megamarket.ru/catalog/details/${id}`;
  }
  if (marketplace === 'aliexpress') {
    const id = productId.replace(/\D/g, '') || productId;
    return `https://aliexpress.ru/item/${id}.html`;
  }
  // Без slug карточки /product/{id} часто бесполезен — оставляем как last resort
  return `https://market.yandex.ru/product/${productId}`;
}

/** @deprecated use normalizeStoredProductUrl / reconstructFallbackUrl */
export function toCanonicalUrl(marketplace: Marketplace, productId: string): string {
  return reconstructFallbackUrl(marketplace, productId);
}

/** Первая валидная товарная ссылка в тексте */
export function parseProductLinkFromText(text: string): ParsedProductLink | null {
  for (const raw of extractUrls(text)) {
    const marketplace = detectMarketplace(raw);
    if (!marketplace) continue;
    const productId = extractProductId(raw, marketplace);
    if (!productId) continue;
    const url = normalizeStoredProductUrl(raw, marketplace, productId);
    const titleHint =
      marketplace === 'yandex_market'
        ? titleHintFromYmUrl(raw) ?? titleHintFromYmUrl(url)
        : marketplace === 'ozon'
          ? titleHintFromOzonUrl(raw) ?? titleHintFromOzonUrl(url)
          : undefined;
    return {
      marketplace,
      productId,
      url,
      titleHint,
    };
  }
  return null;
}
