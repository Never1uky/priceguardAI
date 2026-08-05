/**
 * HTTP-парсеры цен для Deno Edge (без Chrome / DOM).
 * WB — card.wb.ru; Ozon / YM — Scrappey Unlocker + legacy JSON/HTML fallback.
 */

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { fetchViaScrappey, type ScraperCredentials } from './scrappey.ts';
import { getCachedPrice, setCachedPrice } from './price-scrape-cache.ts';
import { fetchedPriceMatchesTracked, logPriceIdentityReject } from './price-identity.ts';

export type Marketplace = 'wildberries' | 'ozon' | 'yandex_market';
export type PriceSource = 'cache' | 'scrappey' | 'legacy';

export interface FetchedPrice {
  price: number;
  title?: string;
  url: string;
  rating?: number | null;
  imageUrl?: string | null;
}

export interface FetchPriceResult extends FetchedPrice {
  source: PriceSource;
}

export interface FetchMarketplacePriceOptions {
  scraper?: ScraperCredentials | null;
  supabase?: SupabaseClient | null;
  skipCacheRead?: boolean;
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

function normalizeKopecks(value: number | undefined): number {
  if (!value || value <= 0) return 0;
  if (value >= 1000) return Math.round(value / 100);
  return value;
}

export function reconstructUrl(marketplace: Marketplace, productId: string): string {
  if (marketplace === 'wildberries') {
    return `https://www.wildberries.ru/catalog/${productId}/detail.aspx`;
  }
  if (marketplace === 'ozon') {
    return `https://www.ozon.ru/product/${productId}/`;
  }
  return `https://market.yandex.ru/product/${productId}`;
}

function pickWbPrice(product: Record<string, unknown>): number {
  const sizes = product.sizes as Array<{ price?: { product?: number; basic?: number } }> | undefined;
  const size = sizes?.[0];
  if (size?.price?.product || size?.price?.basic) {
    const fromSize =
      normalizeKopecks(size.price.product) || normalizeKopecks(size.price.basic);
    if (fromSize) return fromSize;
  }

  const extended = product.extended as
    | { clientSalePrice?: number; basicPriceU?: number }
    | undefined;

  return (
    normalizeKopecks(product.salePriceU as number | undefined) ||
    normalizeKopecks(extended?.clientSalePrice) ||
    normalizeKopecks(product.sale as number | undefined) ||
    normalizeKopecks(product.priceU as number | undefined) ||
    normalizeKopecks(product.basicPriceU as number | undefined) ||
    normalizeKopecks(extended?.basicPriceU) ||
    0
  );
}

function pickOgImage(html: string): string | null {
  const m =
    html.match(/property=["']og:image["']\s+content=["']([^"']+)["']/i) ||
    html.match(/content=["']([^"']+)["']\s+property=["']og:image["']/i);
  const url = m?.[1]?.trim();
  return url?.startsWith('http') ? url : null;
}

function pickHtmlRating(html: string): number | null {
  const m =
    html.match(/itemprop=["']ratingValue["'][^>]*content=["'](\d+(?:[.,]\d+)?)["']/i) ||
    html.match(/content=["'](\d+(?:[.,]\d+)?)["'][^>]*itemprop=["']ratingValue["']/i) ||
    html.match(/"ratingValue"\s*:\s*"?(\d+(?:[.,]\d+)?)"?/i) ||
    html.match(/"rating"\s*:\s*"?(\d+(?:[.,]\d+)?)"?/i);
  if (!m?.[1]) return null;
  const n = Number.parseFloat(m[1].replace(',', '.'));
  return Number.isFinite(n) && n > 0 && n <= 5 ? n : null;
}

/** Корзины WB CDN */
function guessWbImageUrl(nmId: string): string | null {
  const id = Number(nmId);
  if (!Number.isFinite(id) || id <= 0) return null;
  const vol = Math.floor(id / 100000);
  const part = Math.floor(id / 1000);
  const ranges: Array<[number, string]> = [
    [143, '01'], [287, '02'], [431, '03'], [719, '04'], [1007, '05'],
    [1061, '06'], [1115, '07'], [1169, '08'], [1313, '09'], [1601, '10'],
    [1655, '11'], [1919, '12'], [2045, '13'], [2189, '14'], [2405, '15'],
    [2621, '16'], [2837, '17'], [3053, '18'], [3269, '19'], [3485, '20'],
    [3701, '21'], [3917, '22'], [4133, '23'], [4349, '24'], [4565, '25'],
    [4877, '26'], [5189, '27'], [5501, '28'], [5813, '29'], [6125, '30'],
    [6437, '31'], [6749, '32'], [7061, '33'], [7373, '34'],
  ];
  let basket = '35';
  for (const [maxVol, host] of ranges) {
    if (vol <= maxVol) {
      basket = host;
      break;
    }
  }
  return `https://basket-${basket}.wbbasket.ru/vol${vol}/part${part}/${id}/images/big/1.webp`;
}

async function fetchWb(nmId: string): Promise<FetchedPrice | null> {
  const endpoints = [
    `https://card.wb.ru/cards/v4/detail?appType=1&curr=rub&dest=-1257786&nm=${nmId}`,
    `https://card.wb.ru/cards/v2/detail?appType=1&curr=rub&dest=-1257786&nm=${nmId}`,
    `https://card.wb.ru/cards/v1/detail?appType=1&curr=rub&dest=-1257786&nm=${nmId}`,
    `https://card.wb.ru/cards/v1/detail?nm=${nmId}`,
  ];

  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        headers: { Accept: 'application/json', 'User-Agent': UA },
      });
      if (!res.ok) continue;
      const data = await res.json() as {
        data?: { products?: Array<Record<string, unknown>> };
        products?: Array<Record<string, unknown>>;
      };
      const product = data.data?.products?.[0] ?? data.products?.[0];
      if (!product) continue;

      const price = pickWbPrice(product);
      if (!price) continue;

      const brand = String(product.brand ?? '').trim();
      const name = String(product.name ?? product.imt_name ?? '').trim();
      const title = brand && name && !name.toLowerCase().startsWith(brand.toLowerCase())
        ? `${brand} ${name}`
        : name || brand || undefined;

      const rawRating = product.reviewRating ?? product.nmReviewRating;
      const rating =
        typeof rawRating === 'number' && rawRating > 0 ? rawRating : null;

      return {
        price,
        title,
        url: reconstructUrl('wildberries', nmId),
        rating,
        imageUrl: guessWbImageUrl(nmId),
      };
    } catch {
      // next endpoint
    }
  }
  return null;
}

async function fetchOzon(productUrl: string): Promise<FetchedPrice | null> {
  const candidates = ozonUrlCandidates(productUrl);
  for (const candidate of candidates) {
    const fromApi = await fetchOzonComposer(candidate);
    if (fromApi) return fromApi;
    const fromHtml = await fetchOzonHtml(candidate);
    if (fromHtml) return fromHtml;
  }
  return null;
}

function ozonUrlCandidates(productUrl: string): string[] {
  const out: string[] = [];
  const push = (u: string) => {
    if (u && !out.includes(u)) out.push(u);
  };
  try {
    const u = new URL(productUrl);
    u.hash = '';
    u.search = '';
    const path = u.pathname.replace(/\/$/, '') + '/';
    push(`https://www.ozon.ru${path}`);
    const id = extractOzonIdFromPath(path);
    if (id) {
      if (!new RegExp(`/${id}/?$`).test(path) || path.split('-').length > 1) {
        push(`https://www.ozon.ru/product/${id}/`);
      }
    }
  } catch {
    push(productUrl);
  }
  return out;
}

function extractOzonIdFromPath(path: string): string | null {
  const seg = path.match(/\/product\/([^/?#]+)/i)?.[1] ?? '';
  const ids = [...seg.matchAll(/(\d{5,})/g)].map((m) => m[1]);
  return ids.length ? ids[ids.length - 1]! : null;
}

async function fetchOzonComposer(productUrl: string): Promise<FetchedPrice | null> {
  try {
    const path = new URL(productUrl).pathname;
    const endpoints = [
      `https://www.ozon.ru/api/composer-api.bx/page/json/v2?url=${encodeURIComponent(path)}`,
      `https://www.ozon.ru/api/entrypoint-api.bx/page/json/v2?url=${encodeURIComponent(path)}`,
    ];

    for (const apiUrl of endpoints) {
      const res = await fetch(apiUrl, {
        headers: {
          Accept: 'application/json',
          'Accept-Language': 'ru-RU,ru;q=0.9',
          'User-Agent': UA,
          Referer: productUrl,
        },
      });
      if (!res.ok) continue;
      const data = await res.json() as {
        widgetStates?: Record<string, string>;
        seo?: { title?: string };
      };

      const seoTitle = data.seo?.title?.replace(/\s+[—|].*$/, '').trim();
      if (data.widgetStates) {
        for (const raw of Object.values(data.widgetStates)) {
          try {
            const state = JSON.parse(raw) as unknown;
            const found = findOzonPrice(state);
            if (found?.price) {
              return {
                price: found.price,
                title: found.title || seoTitle || undefined,
                url: productUrl,
              };
            }
          } catch {
            // next widget
          }
        }
      }

      const deep = findOzonPrice(data);
      if (deep?.price) {
        return { price: deep.price, title: deep.title || seoTitle, url: productUrl };
      }
    }
  } catch {
    return null;
  }
  return null;
}

function findOzonPrice(
  node: unknown,
  depth = 0,
): { price: number; title?: string } | null {
  if (!node || depth > 14) return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findOzonPrice(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof node !== 'object') return null;
  const obj = node as Record<string, unknown>;

  if (typeof obj.price === 'string') {
    const price = parseInt(obj.price.replace(/\D/g, ''), 10);
    if (price > 0) {
      return {
        price,
        title: typeof obj.title === 'string' ? obj.title : undefined,
      };
    }
  }

  if (typeof obj.cardPrice === 'string' || typeof obj.cardPrice === 'number') {
    const price = parseInt(String(obj.cardPrice).replace(/\D/g, ''), 10);
    if (price > 0) {
      return {
        price,
        title: typeof obj.title === 'string' ? obj.title : undefined,
      };
    }
  }

  const priceV2 = obj.priceV2 as { price?: Array<{ text?: string }> } | undefined;
  if (priceV2?.price?.length) {
    const prices = priceV2.price
      .map((p) => parseInt((p.text ?? '').replace(/\D/g, ''), 10))
      .filter((n) => n > 0);
    if (prices.length) {
      return { price: Math.min(...prices) };
    }
  }

  const atom = obj.atom as Record<string, unknown> | undefined;
  if (atom?.price != null) {
    const price = parseInt(String(atom.price).replace(/\D/g, ''), 10);
    if (price > 0) return { price };
  }

  for (const val of Object.values(obj)) {
    const found = findOzonPrice(val, depth + 1);
    if (found) return found;
  }
  return null;
}

export function parseOzonPriceFromHtml(
  html: string,
  productUrl: string,
): FetchedPrice | null {
  if (/Access Denied|challenge|captcha/i.test(html) && html.length < 50_000) {
    return null;
  }

  const title =
    html.match(/property=["']og:title["']\s+content=["']([^"']+)["']/i)?.[1] ||
    html.match(/<title[^>]*>([^<]+)/i)?.[1];
  const cleanTitle = title
    ?.replace(/\s*[—|].*Ozon.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  const metaPrice =
    html.match(/itemprop=["']price["'][^>]*content=["'](\d+(?:\.\d+)?)["']/i)?.[1] ||
    html.match(/content=["'](\d+(?:\.\d+)?)["'][^>]*itemprop=["']price["']/i)?.[1] ||
    html.match(/"price"\s*:\s*"?(?:RUB\s*)?(\d{3,7})"?/i)?.[1];

  if (metaPrice) {
    const price = Math.round(Number(metaPrice));
    if (price > 0) {
      return {
        price,
        title: cleanTitle,
        url: productUrl,
        imageUrl: pickOgImage(html),
        rating: pickHtmlRating(html),
      };
    }
  }

  for (const m of html.matchAll(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    try {
      const data = JSON.parse(m[1]!);
      const found = findOzonPriceInLd(data);
      if (found) {
        return {
          ...found,
          title: found.title || cleanTitle,
          url: productUrl,
          imageUrl: pickOgImage(html),
          rating: pickHtmlRating(html),
        };
      }
    } catch {
      // next
    }
  }
  return null;
}

async function fetchOzonHtml(productUrl: string): Promise<FetchedPrice | null> {
  try {
    const res = await fetch(productUrl, {
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'ru-RU,ru;q=0.9',
        'User-Agent': UA,
      },
      redirect: 'follow',
    });
    if (!res.ok) return null;
    const html = await res.text();
    return parseOzonPriceFromHtml(html, productUrl);
  } catch {
    return null;
  }
}

function findOzonPriceInLd(
  node: unknown,
  depth = 0,
): { price: number; title?: string } | null {
  if (!node || depth > 10) return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findOzonPriceInLd(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof node !== 'object') return null;
  const obj = node as Record<string, unknown>;
  const type = String(obj['@type'] ?? '');
  if (type.includes('Product') || obj.offers) {
    const offers = obj.offers;
    const list = Array.isArray(offers) ? offers : offers ? [offers] : [];
    for (const offer of list) {
      if (!offer || typeof offer !== 'object') continue;
      const raw = (offer as Record<string, unknown>).price;
      const n = typeof raw === 'number' ? raw : parseInt(String(raw ?? '').replace(/\D/g, ''), 10);
      if (n > 0) {
        return { price: n, title: typeof obj.name === 'string' ? obj.name : undefined };
      }
    }
  }
  for (const val of Object.values(obj)) {
    const found = findOzonPriceInLd(val, depth + 1);
    if (found) return found;
  }
  return null;
}

async function fetchYandex(productUrl: string): Promise<FetchedPrice | null> {
  const candidates = ymUrlCandidates(productUrl);

  for (const candidate of candidates) {
    try {
      const pathname = new URL(candidate).pathname;
      const endpoints = [
        `https://market.yandex.ru/api/resolve/?r=${encodeURIComponent(pathname)}`,
        `https://market.yandex.ru/api/resolve/?r=${encodeURIComponent(pathname + new URL(candidate).search)}`,
      ];

      for (const endpoint of endpoints) {
        const res = await fetch(endpoint, {
          headers: {
            Accept: 'application/json',
            'User-Agent': UA,
            'Accept-Language': 'ru-RU,ru;q=0.9',
          },
        });
        if (!res.ok) continue;
        const data = await res.json();
        const found = findYmPrice(data);
        if (found) return { ...found, url: candidate };
      }

      const htmlRes = await fetch(candidate, {
        headers: {
          Accept: 'text/html,application/xhtml+xml',
          'User-Agent': UA,
          'Accept-Language': 'ru-RU,ru;q=0.9',
        },
        redirect: 'follow',
      });
      if (!htmlRes.ok) continue;
      const html = await htmlRes.text();
      if (/showcaptcha/i.test(html) || /showcaptcha/i.test(htmlRes.url)) continue;
      const fromHtml = parseYmPriceFromHtml(html);
      if (fromHtml) return { ...fromHtml, url: candidate };
    } catch {
      // next candidate
    }
  }

  return null;
}

function ymUrlCandidates(productUrl: string): string[] {
  const out: string[] = [];
  const push = (u: string) => {
    if (u && !out.includes(u)) out.push(u);
  };

  try {
    const u = new URL(productUrl);
    u.hash = '';
    push(u.toString());
    u.search = '';
    push(`${u.origin}${u.pathname.replace(/\/$/, '')}`);

    const idMatch = u.pathname.match(/\/(?:card\/[^/]+|product(?:--[^/]+)?)\/(\d+)/i);
    if (idMatch?.[1] && /\/card\//i.test(u.pathname)) {
      push(`https://market.yandex.ru/product/${idMatch[1]}`);
    }
  } catch {
    push(productUrl);
  }

  return out;
}

export function parseYmPriceFromHtml(html: string): {
  price: number;
  title?: string;
  imageUrl?: string | null;
  rating?: number | null;
} | null {
  if (/showcaptcha/i.test(html)) return null;

  const imageUrl = pickOgImage(html);
  const rating = pickHtmlRating(html);

  const ldBlocks = html.matchAll(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  );
  for (const m of ldBlocks) {
    try {
      const data = JSON.parse(m[1]!) as unknown;
      const found = findYmPriceInLd(data);
      if (found) return { ...found, imageUrl, rating };
    } catch {
      // next
    }
  }

  const meta =
    html.match(/itemprop=["']price["'][^>]*content=["'](\d+(?:\.\d+)?)["']/i) ||
    html.match(/content=["'](\d+(?:\.\d+)?)["'][^>]*itemprop=["']price["']/i);
  if (meta?.[1]) {
    const price = Math.round(Number(meta[1]));
    if (price > 0) {
      const title =
        html.match(/property=["']og:title["']\s+content=["']([^"']+)["']/i)?.[1] ||
        html.match(/<title[^>]*>([^<]+)/i)?.[1];
      return { price, title: title?.trim(), imageUrl, rating };
    }
  }

  const embedded = html.match(/"prices"\s*:\s*\{[^}]{0,120}"value"\s*:\s*"?(\d+)/);
  if (embedded?.[1]) {
    const price = parseInt(embedded[1], 10);
    if (price > 0) return { price, imageUrl, rating };
  }

  return null;
}

function findYmPriceInLd(node: unknown, depth = 0): { price: number; title?: string } | null {
  if (!node || depth > 10) return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findYmPriceInLd(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof node !== 'object') return null;
  const obj = node as Record<string, unknown>;
  const type = String(obj['@type'] ?? '');
  const offers = obj.offers;
  if (offers && (type.includes('Product') || obj.name)) {
    const offerList = Array.isArray(offers) ? offers : [offers];
    for (const offer of offerList) {
      if (!offer || typeof offer !== 'object') continue;
      const o = offer as Record<string, unknown>;
      const raw = o.price ?? o.lowPrice;
      const n = typeof raw === 'number' ? raw : parseInt(String(raw ?? '').replace(/\D/g, ''), 10);
      if (n > 0) return { price: n, title: typeof obj.name === 'string' ? obj.name : undefined };
    }
  }
  for (const val of Object.values(obj)) {
    const found = findYmPriceInLd(val, depth + 1);
    if (found) return found;
  }
  return null;
}

function findYmPrice(node: unknown, depth = 0): { price: number; title?: string } | null {
  if (!node || typeof node !== 'object' || depth > 12) return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findYmPrice(item, depth + 1);
      if (found) return found;
    }
    return null;
  }

  const obj = node as Record<string, unknown>;
  const titles = obj.titles as { raw?: string } | undefined;
  const prices = obj.prices as { value?: string | number } | undefined;
  if (prices?.value != null) {
    const n = typeof prices.value === 'number'
      ? prices.value
      : parseInt(String(prices.value).replace(/\D/g, ''), 10);
    if (n > 0) return { price: n, title: titles?.raw };
  }

  for (const val of Object.values(obj)) {
    const found = findYmPrice(val, depth + 1);
    if (found) return found;
  }
  return null;
}

export function parseWbPriceFromHtml(html: string, productUrl: string): FetchedPrice | null {
  const saleMatch = html.match(/"salePriceU"\s*:\s*(\d+)/);
  const priceMatch = html.match(/"priceU"\s*:\s*(\d+)/);
  const sale = normalizeKopecks(saleMatch?.[1] ? Number(saleMatch[1]) : undefined);
  const basic = normalizeKopecks(priceMatch?.[1] ? Number(priceMatch[1]) : undefined);
  const price = sale || basic;
  if (!price) return null;
  const nameMatch = html.match(/"imt_name"\s*:\s*"((?:\\.|[^"\\])*)"/);
  const brandMatch = html.match(/"brand"\s*:\s*"((?:\\.|[^"\\])*)"/);
  const decode = (s?: string) =>
    s?.replace(/\\u([0-9a-fA-F]{4})/g, (_, c) => String.fromCharCode(parseInt(c, 16))) ?? '';
  const title = [decode(brandMatch?.[1]), decode(nameMatch?.[1])].filter(Boolean).join(' ').trim();
  return { price, title: title || undefined, url: productUrl };
}

async function fetchViaUnlocker(
  marketplace: Marketplace,
  productUrl: string,
  scraper: ScraperCredentials,
): Promise<FetchedPrice | null> {
  const candidates =
    marketplace === 'ozon'
      ? ozonUrlCandidates(productUrl)
      : marketplace === 'yandex_market'
        ? ymUrlCandidates(productUrl)
        : [productUrl];

  for (const candidate of candidates.slice(0, 2)) {
    const unlocked = await fetchViaScrappey(candidate, scraper, { country: 'ru' });
    if (!unlocked.html) continue;

    if (marketplace === 'ozon') {
      const parsed = parseOzonPriceFromHtml(unlocked.html, candidate);
      if (parsed) return parsed;
    } else if (marketplace === 'yandex_market') {
      const parsed = parseYmPriceFromHtml(unlocked.html);
      if (parsed) return { ...parsed, url: candidate };
    } else {
      const parsed = parseWbPriceFromHtml(unlocked.html, candidate);
      if (parsed) return parsed;
    }
  }
  return null;
}

async function fetchLegacy(
  marketplace: Marketplace,
  productId: string,
  url: string,
): Promise<FetchedPrice | null> {
  if (marketplace === 'wildberries') return fetchWb(productId);
  if (marketplace === 'ozon') return fetchOzon(url);
  return fetchYandex(url);
}

export async function fetchMarketplacePriceDetailed(
  marketplace: Marketplace,
  productId: string,
  productUrl?: string | null,
  options?: FetchMarketplacePriceOptions,
): Promise<FetchPriceResult | null> {
  const url = (productUrl && productUrl.startsWith('http'))
    ? productUrl
    : reconstructUrl(marketplace, productId);

  const supabase = options?.supabase ?? null;
  const scraper = options?.scraper?.apiKey ? options.scraper : null;

  if (supabase && !options?.skipCacheRead) {
    const cached = await getCachedPrice(supabase, marketplace, productId);
    if (cached?.price) {
      const identity = fetchedPriceMatchesTracked({
        marketplace,
        productId,
        productUrl: url,
        fetchedUrl: cached.url || url,
        fetchedTitle: cached.title,
      });
      if (identity.ok === false) {
        logPriceIdentityReject({
          reason: identity.reason,
          marketplace,
          productId,
          cachedUrl: cached.url,
        });
      } else {
        return {
          price: cached.price,
          title: cached.title,
          url: cached.url || url,
          source: 'cache',
        };
      }
    }
  }

  let result: FetchedPrice | null = null;
  let source: Exclude<PriceSource, 'cache'> = 'legacy';

  if (marketplace === 'wildberries') {
    result = await fetchWb(productId);
    if (!result && scraper) {
      result = await fetchViaUnlocker(marketplace, url, scraper);
      if (result) source = 'scrappey';
    }
  } else if (scraper) {
    result = await fetchViaUnlocker(marketplace, url, scraper);
    if (result) {
      source = 'scrappey';
    } else {
      result = await fetchLegacy(marketplace, productId, url);
      source = 'legacy';
    }
  } else {
    result = await fetchLegacy(marketplace, productId, url);
  }

  if (!result?.price || result.price <= 0) return null;

  const fetched: FetchPriceResult = {
    price: result.price,
    title: result.title,
    url: result.url || url,
    source,
  };

  const identity = fetchedPriceMatchesTracked({
    marketplace,
    productId,
    productUrl: url,
    fetchedUrl: fetched.url,
    fetchedTitle: fetched.title,
  });
  if (identity.ok === false) {
    logPriceIdentityReject({
      reason: identity.reason,
      marketplace,
      productId,
      fetchedUrl: fetched.url,
      fetchedTitle: fetched.title?.slice(0, 80),
    });
    return null;
  }

  if (supabase) {
    await setCachedPrice(supabase, marketplace, productId, fetched, source);
  }

  return fetched;
}

export async function fetchMarketplacePrice(
  marketplace: Marketplace,
  productId: string,
  productUrl?: string | null,
  options?: FetchMarketplacePriceOptions,
): Promise<FetchedPrice | null> {
  const detailed = await fetchMarketplacePriceDetailed(
    marketplace,
    productId,
    productUrl,
    options,
  );
  if (!detailed) return null;
  return { price: detailed.price, title: detailed.title, url: detailed.url };
}

export function formatRub(n: number): string {
  return new Intl.NumberFormat('ru-RU').format(Math.round(n)) + ' ₽';
}

/** Ozon server scrapes: extra safety margin on top of user thresholds (personal prices differ). */
export const OZON_SERVER_DROP_MARGIN_RUB = 100;
export const OZON_SERVER_DROP_MARGIN_PCT = 2;

/**
 * Effective drop thresholds for server-side alerts (Telegram cron).
 * Ozon: user mins + margin. WB / YM: unchanged.
 */
export function effectiveServerDropThresholds(
  marketplace: Marketplace,
  minDropRub: number,
  minDropPercent: number,
): { minDropRub: number; minDropPercent: number } {
  if (marketplace === 'ozon') {
    return {
      minDropRub: minDropRub + OZON_SERVER_DROP_MARGIN_RUB,
      minDropPercent: minDropPercent + OZON_SERVER_DROP_MARGIN_PCT,
    };
  }
  return { minDropRub, minDropPercent };
}

export function isSignificantDrop(
  previous: number,
  next: number,
  minDropRub: number,
  minDropPercent: number,
): boolean {
  if (next >= previous || previous <= 0) return false;
  const drop = previous - next;
  const percent = (drop / previous) * 100;
  if (minDropPercent > 0 && percent < minDropPercent) return false;
  if (drop < minDropRub) return false;
  return true;
}
