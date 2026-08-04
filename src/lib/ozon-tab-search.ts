/**
 * Поиск на Ozon через API внутри уже открытой вкладки выдачи.
 * При пустых widgetStates — DOM fallback (без Scrappey).
 */
import type { MarketplaceOffer } from '@/types/comparison';
import { parseAllOzonSearchOffers, parseOzonWidgetStates } from '@/lib/ozon-offer';
import { attachPickHistoryBoosts } from '@/lib/pick-history';
import { pickTopMatchesWithScore, isUrlExcluded } from '@/lib/product-match';
import { matchConfidencePercent } from '@/lib/fuzzy-match';
import { buildOfferFromRankedCandidates } from '@/lib/search-offer-from-candidates';
import { MAX_CANDIDATE_POOL } from '@/lib/candidate-pool';
import { buildMarketplaceSearchUrl } from '@/utils/comparison-url';
import { scrapeOzonSerpDomInTab } from '@/lib/ozon-serp-dom';

type WidgetStates = Record<string, string>;

/** Запрос composer API из контекста страницы Ozon (есть cookies). */
async function fetchOzonWidgetStatesInTab(tabId: number, path: string): Promise<WidgetStates | null> {
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: async (apiPath: string) => {
        try {
          const res = await fetch(
            `https://www.ozon.ru/api/composer-api.bx/page/json/v2?url=${encodeURIComponent(apiPath)}`,
            {
              credentials: 'include',
              headers: { Accept: 'application/json', 'Accept-Language': 'ru-RU,ru;q=0.9' },
            },
          );
          if (!res.ok) return null;
          const data = (await res.json()) as { widgetStates?: WidgetStates };
          return data.widgetStates ?? null;
        } catch {
          return null;
        }
      },
      args: [path],
    });

    return (result as WidgetStates | null) ?? null;
  } catch {
    return null;
  }
}

/**
 * Поиск на Ozon через API внутри уже открытой вкладки.
 * Возвращает auto-pick или needsManualPick с пулом кандидатов (как SW-путь).
 */
export async function searchOzonInTab(
  tabId: number,
  query: string,
  referenceTitle: string,
  referencePrice?: number,
  excludedUrls?: string[],
): Promise<MarketplaceOffer | null> {
  const ref = referenceTitle && referenceTitle !== 'Товар' ? referenceTitle : query;
  const searchUrl = buildMarketplaceSearchUrl('ozon', query);
  // Prefer global search path; also try current tab path (category SERP often has widgets)
  let tabPath: string | null = null;
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.url) {
      const u = new URL(tab.url);
      if (/ozon\.ru/i.test(u.hostname)) {
        tabPath = `${u.pathname}${u.search}`;
      }
    }
  } catch {
    // ignore
  }
  const searchPath = `/search/?text=${query}&deny_category_prediction=true&from_global=true`;
  const paths = [searchPath, tabPath].filter(
    (p, i, arr): p is string => Boolean(p) && arr.indexOf(p) === i,
  );

  // Short ladder — empty widgets → one longer hydrate pass → DOM
  const delays = [0, 800, 1_800];
  let sawEmptyWidgets = false;

  for (const wait of delays) {
    if (wait) await new Promise((r) => setTimeout(r, wait));

    for (const path of paths) {
      const widgetStates = await fetchOzonWidgetStatesInTab(tabId, path);
      if (!widgetStates || Object.keys(widgetStates).length === 0) {
        sawEmptyWidgets = true;
        continue;
      }

      const offers = parseAllOzonSearchOffers(widgetStates, searchUrl).filter(
        (o) => o.url && !isUrlExcluded(o.url, excludedUrls),
      );
      if (!offers.length) {
        sawEmptyWidgets = true;
        continue;
      }

      const ozonGetTitle = (o: MarketplaceOffer) => o.title;
      const ozonPickBase = {
        referencePrice,
        excludedUrls,
        getPrice: (o: unknown) => (o as MarketplaceOffer).price,
        getUrl: (o: unknown) => (o as MarketplaceOffer).url,
      };
      const ozonPickOpts = await attachPickHistoryBoosts(
        ref,
        'ozon',
        offers,
        ozonPickBase,
        ozonGetTitle,
      );

      const top = pickTopMatchesWithScore(ref, offers, ozonGetTitle, {
        ...ozonPickOpts,
        limit: MAX_CANDIDATE_POOL,
      });

      if (!top.length) continue;

      const ranked = top.map(({ item, score }) => ({
        offer: item,
        confidence: matchConfidencePercent(score),
      }));

      return buildOfferFromRankedCandidates('ozon', query, searchUrl, ranked);
    }
  }

  // Soft hydrate: page SDK may still be loading (e.g. Brave Shields) — one longer wait
  if (sawEmptyWidgets) {
    await new Promise((r) => setTimeout(r, 3_000));
    for (const path of paths) {
      const widgetStates = await fetchOzonWidgetStatesInTab(tabId, path);
      if (!widgetStates || Object.keys(widgetStates).length === 0) continue;

      const offers = parseAllOzonSearchOffers(widgetStates, searchUrl).filter(
        (o) => o.url && !isUrlExcluded(o.url, excludedUrls),
      );
      if (!offers.length) continue;

      const ozonGetTitle = (o: MarketplaceOffer) => o.title;
      const ozonPickBase = {
        referencePrice,
        excludedUrls,
        getPrice: (o: unknown) => (o as MarketplaceOffer).price,
        getUrl: (o: unknown) => (o as MarketplaceOffer).url,
      };
      const ozonPickOpts = await attachPickHistoryBoosts(
        ref,
        'ozon',
        offers,
        ozonPickBase,
        ozonGetTitle,
      );

      const top = pickTopMatchesWithScore(ref, offers, ozonGetTitle, {
        ...ozonPickOpts,
        limit: MAX_CANDIDATE_POOL,
      });

      if (!top.length) continue;

      const ranked = top.map(({ item, score }) => ({
        offer: item,
        confidence: matchConfidencePercent(score),
      }));

      return buildOfferFromRankedCandidates('ozon', query, searchUrl, ranked);
    }
  }

  // Widgets empty / unusable → DOM tiles (same tab, no Scrappey)
  return scrapeOzonSerpDomInTab(tabId, query, ref, referencePrice, excludedUrls);
}

/** Карточка товара Ozon через API в контексте вкладки. */
export async function fetchOzonProductInTab(
  tabId: number,
  productUrl: string,
): Promise<MarketplaceOffer | null> {
  let path: string;
  try {
    path = new URL(productUrl).pathname;
  } catch {
    return null;
  }

  const widgetStates = await fetchOzonWidgetStatesInTab(tabId, path);
  if (!widgetStates) return null;

  return parseOzonWidgetStates(widgetStates, productUrl);
}
