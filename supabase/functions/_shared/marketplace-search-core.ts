/**
 * Shared marketplace SERP fetch used by compare-research and the shopping agent.
 * Logic moved out of compare-research/index.ts — do not fork a second search engine.
 *
 * Megamarket / AliExpress / M.Video: no invented HTTP search API — try public SERP HTML when
 * available; otherwise [] so the client falls back to HiddenBrowser tab (tab-or-available).
 */

export type Marketplace =
  | 'wildberries'
  | 'ozon'
  | 'yandex_market'
  | 'megamarket'
  | 'aliexpress'
  | 'mvideo';

export type CoreResearchMarketplace = 'wildberries' | 'ozon' | 'yandex_market';

export const COMPARE_RESEARCH_VALID: Marketplace[] = [
  'wildberries',
  'ozon',
  'yandex_market',
  'megamarket',
  'aliexpress',
  'mvideo',
];

export interface SearchCandidate {
  title: string;
  url: string;
  price: number | null;
  matchConfidence: number;
  imageUrl?: string;
}

export function scoreTitle(ref: string, cand: string): number {
  const a = ref.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
  const b = new Set(cand.toLowerCase().split(/\s+/).filter((t) => t.length > 2));
  if (!a.length) return 50;
  let hit = 0;
  for (const t of a) if (b.has(t)) hit += 1;
  return Math.round((hit / a.length) * 100);
}

/**
 * Mega SERP confidence closer to client identity gates:
 * drop obvious category junk / storage mismatch instead of blind token overlap.
 */
export function megaSerpMatchConfidence(ref: string, cand: string): number {
  const r = ref.trim();
  const c = cand.trim();
  if (!r || !c) return 0;

  const phoneish = /смартфон|телефон|iphone|pixel|galaxy|redmi|xiaomi|poco|realme|honor|huawei|samsung|smartphone|ноутбук|laptop|macbook|notebook/i;
  const accessoryJunk =
    /чехол|стекл[оа]\s*защит|кабель|провод|адаптер|наушник|кейc|\bcase\b|\bcover\b|\bsleeve\b|\bpouch\b|\bcharger\b|\badapter\b|\btempered\s+glass\b|\bscreen\s+protector\b|\bcharging\s+cable\b|плёнк|пленк|защитн\w*\s+(?:стекл|плёнк|пленк)|держатель|подставк|сумк\w*\s+для\s+(?:ноут|laptop)|\blaptop\s+(?:sleeve|bag|case)\b/i;
  const furnitureFoodJunk =
    /комод|диван|кровать|шкаф|стол\b|стул|крабов|палочк|йогурт|молоко/i;
  const replicaJunk =
    /муляж|имитац|реквизит|нефункционал|не\s*рабоч|игрушк|dummy|mockup|display\s*model|реплик|копия/i;
  // Accessories / furniture / food / dummies are never a phone/laptop SKU match.
  if (accessoryJunk.test(c) || furnitureFoodJunk.test(c) || replicaJunk.test(c)) {
    if (phoneish.test(r) || /смартфон|телефон|ноутбук|laptop/i.test(r)) {
      // Allow when reference itself is a dummy/replica or accessory search
      if (!replicaJunk.test(r) && !accessoryJunk.test(r)) return 0;
    }
  }

  const storages = (s: string): number[] => {
    const out: number[] = [];
    for (const m of s.matchAll(/(\d+)\s*(?:gb|гб)/gi)) {
      const n = Number(m[1]);
      if (n >= 32 && n <= 2048) out.push(n);
    }
    return out;
  };
  const refS = storages(r);
  const candS = storages(c);
  // Both sides explicit single storage (or ROM-like) and disagree → reject
  if (refS.length === 1 && candS.length === 1 && refS[0] !== candS[0]) {
    return 0;
  }
  // RAM/ROM like 12/128 vs candidate only 256
  const slash = r.match(/(\d{1,2})\s*\/\s*(\d{2,4})\s*(?:gb|гб)?/i);
  if (slash && candS.length === 1) {
    const rom = Number(slash[2]);
    if (rom >= 32 && candS[0] !== rom && !candS.includes(rom)) {
      return 0;
    }
  }

  return scoreTitle(r, c);
}

export function matchConfidenceForMarketplace(
  marketplace: Marketplace,
  referenceTitle: string,
  candidateTitle: string,
): number {
  if (
    marketplace === 'megamarket' ||
    marketplace === 'aliexpress' ||
    marketplace === 'mvideo'
  ) {
    return megaSerpMatchConfidence(referenceTitle, candidateTitle);
  }
  return scoreTitle(referenceTitle, candidateTitle);
}

/**
 * VALID research MPs ∩ requested selected; empty request → all VALID except source.
 * Never expands beyond VALID (test MPs stay client-tab only).
 */
export function resolveCompareResearchTargets(
  sourceMarketplace: Marketplace,
  requested: unknown,
  valid: readonly Marketplace[] = COMPARE_RESEARCH_VALID,
): Marketplace[] {
  const base = valid.filter((m) => m !== sourceMarketplace);
  if (!Array.isArray(requested) || requested.length === 0) {
    return [...base];
  }
  const want = new Set(
    requested.filter((x): x is string => typeof x === 'string').map((x) => x.trim()),
  );
  return base.filter((m) => want.has(m));
}

const SERP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

/** Parse Mega catalog HTML for details tiles (no DOM — Edge-safe regex). */
export function parseMegamarketSerpHtml(
  html: string,
  referenceTitle: string,
): SearchCandidate[] {
  if (!html || html.length < 200) return [];
  const out: SearchCandidate[] = [];
  const seen = new Set<string>();

  const push = (id: string, titleHint: string, price: number | null) => {
    const digits = id.replace(/\D/g, '');
    if (digits.length < 6) return;
    if (seen.has(digits)) return;
    const title = (titleHint || '').replace(/\s+/g, ' ').trim().slice(0, 200);
    if (title.length < 3) return;
    const matchConfidence = megaSerpMatchConfidence(referenceTitle, title);
    if (matchConfidence <= 0) return;
    seen.add(digits);
    out.push({
      title,
      url: `https://megamarket.ru/catalog/details/${digits}/`,
      price: price && price > 0 ? price : null,
      matchConfidence,
    });
  };

  // data-product-id / data-goods-id tiles
  for (const m of html.matchAll(
    /data-(?:product|goods)-id=["'](\d{6,})["'][^>]*>([\s\S]{0,1200}?)<\/(?:div|article|li|a)/gi,
  )) {
    const id = m[1]!;
    const chunk = m[2] ?? '';
    const title =
      chunk.match(/<(?:h[23]|span|a)[^>]*>([^<]{4,180})<\/(?:h[23]|span|a)>/i)?.[1] ??
      chunk.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
    const priceRaw = chunk.match(/(\d[\d\s]{2,})\s*(?:₽|руб)/i)?.[1];
    const price = priceRaw ? Number(priceRaw.replace(/\s/g, '')) : null;
    push(id, title, price && Number.isFinite(price) ? price : null);
    if (out.length >= 8) return out;
  }

  // /catalog/details/… anchors
  for (const m of html.matchAll(
    /href=["']([^"']*\/catalog\/details\/[^"'?#]+(?:\?[^"']*)?)["'][^>]*>([\s\S]{0,400}?)<\/a>/gi,
  )) {
    const href = m[1] ?? '';
    const id = href.match(/\/catalog\/details\/[^/?#]*?(\d{6,})/i)?.[1];
    if (!id) continue;
    const inner = (m[2] ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const titleAttr = html
      .slice(Math.max(0, (m.index ?? 0) - 200), m.index ?? 0)
      .match(/title=["']([^"']{4,180})["']/i)?.[1];
    push(id, titleAttr || inner, null);
    if (out.length >= 8) break;
  }

  return out.slice(0, 8);
}

/**
 * Mega SERP: attempt public HTML catalog page. Antibot → [] (client tab).
 * Never calls Scrappey for search listings.
 */
export async function searchMegamarket(
  query: string,
  referenceTitle: string,
): Promise<SearchCandidate[]> {
  const url = `https://megamarket.ru/catalog/?q=${encodeURIComponent(query)}`;
  try {
    const res = await fetch(url, {
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'ru-RU,ru;q=0.9',
        'User-Agent': SERP_UA,
      },
      redirect: 'follow',
    });
    if (!res.ok) return [];
    const html = await res.text();
    // Soft-block / empty shells
    if (/captcha|access.?denied|cf-browser-verification/i.test(html) && html.length < 50_000) {
      return [];
    }
    return parseMegamarketSerpHtml(html, referenceTitle || query);
  } catch {
    return [];
  }
}

/** Parse AliExpress wholesale / search HTML for /item/{id} tiles (Edge-safe regex). */
export function parseAliExpressSerpHtml(
  html: string,
  referenceTitle: string,
): SearchCandidate[] {
  if (!html || html.length < 200) return [];
  const out: SearchCandidate[] = [];
  const seen = new Set<string>();

  const push = (id: string, titleHint: string, price: number | null) => {
    const digits = id.replace(/\D/g, '');
    if (digits.length < 8) return;
    if (seen.has(digits)) return;
    const title = (titleHint || '').replace(/\s+/g, ' ').trim().slice(0, 200);
    if (title.length < 3) return;
    const matchConfidence = megaSerpMatchConfidence(referenceTitle, title);
    if (matchConfidence <= 0) return;
    seen.add(digits);
    out.push({
      title,
      url: `https://aliexpress.ru/item/${digits}.html`,
      price: price && price > 0 ? price : null,
      matchConfidence,
    });
  };

  // href="/item/100500….html" with nearby title / price
  for (const m of html.matchAll(
    /href=["']([^"']*\/item\/(\d{8,})(?:\.html)?[^"']*)["'][^>]*>([\s\S]{0,500}?)<\/a>/gi,
  )) {
    const id = m[2]!;
    const inner = (m[3] ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const before = html.slice(Math.max(0, (m.index ?? 0) - 280), m.index ?? 0);
    const titleAttr =
      before.match(/title=["']([^"']{4,180})["']/i)?.[1] ||
      before.match(/alt=["']([^"']{4,180})["']/i)?.[1];
    const priceRaw =
      (m[3] ?? '').match(/(\d[\d\s]{1,})\s*(?:₽|руб|RUB)/i)?.[1] ||
      before.match(/(\d[\d\s]{1,})\s*(?:₽|руб|RUB)/i)?.[1];
    const price = priceRaw ? Number(priceRaw.replace(/\s/g, '')) : null;
    push(id, titleAttr || inner, price && Number.isFinite(price) ? price : null);
    if (out.length >= 8) return out;
  }

  // Bare item links without rich inner HTML
  for (const m of html.matchAll(/\/item\/(\d{8,})(?:\.html)?/gi)) {
    const id = m[1]!;
    if (seen.has(id)) continue;
    const start = Math.max(0, (m.index ?? 0) - 120);
    const window = html.slice(start, (m.index ?? 0) + 220);
    const title =
      window.match(/title=["']([^"']{4,180})["']/i)?.[1] ||
      window.match(/alt=["']([^"']{4,180})["']/i)?.[1] ||
      '';
    if (title.length < 3) continue;
    push(id, title, null);
    if (out.length >= 8) break;
  }

  return out.slice(0, 8);
}

/**
 * Ali SERP: attempt public wholesale HTML. Antibot → [] (client tab).
 * Never calls Scrappey for search listings.
 */
export async function searchAliExpress(
  query: string,
  referenceTitle: string,
): Promise<SearchCandidate[]> {
  const url = `https://aliexpress.ru/wholesale?SearchText=${encodeURIComponent(query)}`;
  try {
    const res = await fetch(url, {
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'ru-RU,ru;q=0.9',
        'User-Agent': SERP_UA,
      },
      redirect: 'follow',
    });
    if (!res.ok) return [];
    const html = await res.text();
    if (
      (/captcha|access.?denied|cf-browser-verification|robot.?check/i.test(html) &&
        html.length < 50_000) ||
      html.length < 200
    ) {
      return [];
    }
    return parseAliExpressSerpHtml(html, referenceTitle || query);
  } catch {
    return [];
  }
}

/** Parse M.Video / Eldorado SERP HTML for product tiles (Edge-safe regex). */
export function parseMvideoSerpHtml(
  html: string,
  referenceTitle: string,
): SearchCandidate[] {
  if (!html || html.length < 200) return [];
  const out: SearchCandidate[] = [];
  const seen = new Set<string>();

  const push = (id: string, titleHint: string, price: number | null, hrefHint?: string) => {
    const digits = id.replace(/\D/g, '');
    if (digits.length < 6) return;
    if (seen.has(digits)) return;
    const title = (titleHint || '').replace(/\s+/g, ' ').trim().slice(0, 200);
    if (title.length < 3) return;
    const matchConfidence = megaSerpMatchConfidence(referenceTitle, title);
    if (matchConfidence <= 0) return;
    seen.add(digits);
    const eldorado = hrefHint && /eldorado\.ru/i.test(hrefHint);
    const url = eldorado
      ? `https://www.eldorado.ru/cat/detail/${digits}/`
      : `https://www.mvideo.ru/products/${digits}`;
    out.push({
      title,
      url,
      price: price && price > 0 ? price : null,
      matchConfidence,
    });
  };

  // /products/…{id} anchors (mvideo.ru)
  for (const m of html.matchAll(
    /href=["']([^"']*\/products\/[^"'?#]+(?:\?[^"']*)?)["'][^>]*>([\s\S]{0,500}?)<\/a>/gi,
  )) {
    const href = m[1] ?? '';
    if (/product-list-page|\/search/i.test(href)) continue;
    const id = href.match(/\/products\/[^/?#]*?(\d{6,})/i)?.[1];
    if (!id) continue;
    const inner = (m[2] ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const before = html.slice(Math.max(0, (m.index ?? 0) - 280), m.index ?? 0);
    const titleAttr =
      before.match(/title=["']([^"']{4,180})["']/i)?.[1] ||
      before.match(/alt=["']([^"']{4,180})["']/i)?.[1];
    const priceRaw =
      (m[2] ?? '').match(/(\d[\d\s]{1,})\s*(?:₽|руб|RUB)/i)?.[1] ||
      before.match(/(\d[\d\s]{1,})\s*(?:₽|руб|RUB)/i)?.[1];
    const price = priceRaw ? Number(priceRaw.replace(/\s/g, '')) : null;
    push(id, titleAttr || inner, price && Number.isFinite(price) ? price : null, href);
    if (out.length >= 8) return out;
  }

  // Eldorado /item/{id} or /cat/detail/…
  for (const m of html.matchAll(
    /href=["']([^"']*(?:\/item\/\d+|\/cat\/detail\/[^"'?#]+|\/catalog\/product\/[^"'?#]+)(?:\?[^"']*)?)["'][^>]*>([\s\S]{0,500}?)<\/a>/gi,
  )) {
    const href = m[1] ?? '';
    const id =
      href.match(/\/item\/(\d{6,})/i)?.[1] ||
      href.match(/\/(?:cat\/detail|catalog\/product)\/[^/?#]*?(\d{5,})/i)?.[1];
    if (!id) continue;
    const inner = (m[2] ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const before = html.slice(Math.max(0, (m.index ?? 0) - 280), m.index ?? 0);
    const titleAttr =
      before.match(/title=["']([^"']{4,180})["']/i)?.[1] ||
      before.match(/alt=["']([^"']{4,180})["']/i)?.[1];
    push(id, titleAttr || inner, null, href);
    if (out.length >= 8) break;
  }

  // Bare /products/…{id} without rich anchor body
  for (const m of html.matchAll(/\/products\/[^/?#]*?(\d{6,})/gi)) {
    const id = m[1]!;
    if (seen.has(id)) continue;
    const start = Math.max(0, (m.index ?? 0) - 120);
    const window = html.slice(start, (m.index ?? 0) + 220);
    const title =
      window.match(/title=["']([^"']{4,180})["']/i)?.[1] ||
      window.match(/alt=["']([^"']{4,180})["']/i)?.[1] ||
      '';
    if (title.length < 3) continue;
    push(id, title, null);
    if (out.length >= 8) break;
  }

  return out.slice(0, 8);
}

/**
 * M.Video SERP: attempt public product-list HTML. Antibot → [] (client tab).
 * Never calls Scrappey for search listings.
 */
export async function searchMvideo(
  query: string,
  referenceTitle: string,
): Promise<SearchCandidate[]> {
  const url = `https://www.mvideo.ru/product-list-page?q=${encodeURIComponent(query)}`;
  try {
    const res = await fetch(url, {
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'ru-RU,ru;q=0.9',
        'User-Agent': SERP_UA,
      },
      redirect: 'follow',
    });
    if (!res.ok) return [];
    const html = await res.text();
    if (
      (/captcha|access.?denied|cf-browser-verification|robot.?check/i.test(html) &&
        html.length < 50_000) ||
      html.length < 200
    ) {
      return [];
    }
    return parseMvideoSerpHtml(html, referenceTitle || query);
  } catch {
    return [];
  }
}

export async function searchWb(query: string, referenceTitle: string): Promise<SearchCandidate[]> {
  const apiUrl =
    `https://search.wb.ru/exactmatch/ru/common/v5/search` +
    `?appType=1&curr=rub&dest=-1257786&query=${encodeURIComponent(query)}` +
    `&resultset=catalog&sort=popular&spp=30&page=1`;
  const res = await fetch(apiUrl, { headers: { Accept: 'application/json' } });
  if (!res.ok) return [];
  const data = await res.json() as {
    data?: { products?: Array<{ id?: number; name?: string; brand?: string; salePriceU?: number; priceU?: number }> };
  };
  const products = data.data?.products ?? [];
  return products.slice(0, 8).map((p) => {
    const title = [p.brand, p.name].filter(Boolean).join(' ') || query;
    const sale = p.salePriceU ? Math.round(p.salePriceU / 100) : null;
    const basic = p.priceU ? Math.round(p.priceU / 100) : null;
    const price = sale || basic;
    return {
      title,
      url: p.id ? `https://www.wildberries.ru/catalog/${p.id}/detail.aspx` : '',
      price,
      matchConfidence: scoreTitle(referenceTitle, title),
    };
  }).filter((c) => c.url);
}

export async function searchOzon(query: string, referenceTitle: string): Promise<SearchCandidate[]> {
  const path = `/search/?text=${query}&deny_category_prediction=true`;
  const apiUrl =
    `https://www.ozon.ru/api/composer-api.bx/page/json/v2?url=${encodeURIComponent(path)}`;
  const res = await fetch(apiUrl, {
    headers: { Accept: 'application/json', 'Accept-Language': 'ru-RU,ru;q=0.9' },
  });
  if (!res.ok) return [];
  const data = await res.json() as { widgetStates?: Record<string, string> };
  const out: SearchCandidate[] = [];
  for (const raw of Object.values(data.widgetStates ?? {})) {
    try {
      const parsed = JSON.parse(raw) as {
        items?: Array<{
          mainState?: Array<{ type?: string; atom?: { textAtom?: { text?: string }; priceV2?: { price?: Array<{ text?: string }> } } }>;
          action?: { link?: string };
        }>;
      };
      for (const item of parsed.items ?? []) {
        const link = item.action?.link ?? '';
        if (!link.includes('/product/')) continue;
        let title = query;
        let price: number | null = null;
        for (const st of item.mainState ?? []) {
          const text = st.atom?.textAtom?.text;
          if (text && st.type?.toLowerCase().includes('text')) title = text;
          const priceText = st.atom?.priceV2?.price?.[0]?.text;
          if (priceText) {
            const n = Number(priceText.replace(/[^\d]/g, ''));
            if (n > 0) price = n;
          }
        }
        const url = link.startsWith('http') ? link : `https://www.ozon.ru${link}`;
        out.push({
          title,
          url: url.split('?')[0]!,
          price,
          matchConfidence: scoreTitle(referenceTitle, title),
        });
      }
    } catch {
      // skip widget
    }
  }
  return out.slice(0, 8);
}

export async function searchYm(query: string, referenceTitle: string): Promise<SearchCandidate[]> {
  const apiUrl =
    `https://market.yandex.ru/api/resolve/?r=search%2Fsearch` +
    `&text=${encodeURIComponent(query)}&cvredirect=0&how=aprice`;
  try {
    const res = await fetch(apiUrl, {
      headers: { Accept: 'application/json', 'Accept-Language': 'ru-RU' },
    });
    if (!res.ok) return [];
    const data = await res.json();
    const out: SearchCandidate[] = [];
    const walk = (node: unknown): void => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        for (const x of node) walk(x);
        return;
      }
      const obj = node as Record<string, unknown>;
      if (obj.titles && obj.prices) {
        const titles = obj.titles as { raw?: string };
        const prices = obj.prices as { value?: string | number };
        const slug = String(obj.slug ?? '');
        const id = String((obj as { id?: string }).id ?? '');
        const title = titles.raw || query;
        const price = Number(prices.value) || null;
        const url = id
          ? `https://market.yandex.ru/product/${id}`
          : slug
            ? `https://market.yandex.ru/product--${slug}`
            : '';
        if (url) {
          out.push({
            title,
            url,
            price,
            matchConfidence: scoreTitle(referenceTitle, title),
          });
        }
      }
      for (const v of Object.values(obj)) walk(v);
    };
    walk(data);
    return out.slice(0, 8);
  } catch {
    return [];
  }
}

export const MARKETPLACE_SEARCHERS: Record<
  Marketplace,
  (query: string, referenceTitle: string) => Promise<SearchCandidate[]>
> = {
  wildberries: searchWb,
  ozon: searchOzon,
  yandex_market: searchYm,
  megamarket: searchMegamarket,
  aliexpress: searchAliExpress,
  mvideo: searchMvideo,
};
