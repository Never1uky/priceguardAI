/**
 * Shared marketplace SERP fetch used by compare-research and the shopping agent.
 * Logic moved out of compare-research/index.ts — do not fork a second search engine.
 */

export type Marketplace = 'wildberries' | 'ozon' | 'yandex_market';

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
};
