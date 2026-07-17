/**
 * Поиск на Ozon через API внутри уже открытой вкладки выдачи.
 */
import type { MarketplaceOffer } from '@/types/comparison';
import { parseAllOzonSearchOffers, parseOzonWidgetStates } from '@/lib/ozon-offer';
import { pickTopMatchesWithScore, isUrlExcluded } from '@/lib/product-match';
import { matchConfidencePercent } from '@/lib/fuzzy-match';
import { buildOfferFromRankedCandidates } from '@/lib/search-offer-from-candidates';
import { MAX_CANDIDATE_POOL } from '@/lib/candidate-pool';
import { buildMarketplaceSearchUrl } from '@/utils/comparison-url';

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
  const searchPath = `/search/?text=${encodeURIComponent(query)}`;

  const delays = [0, 2_000, 4_000, 6_000, 8_000];

  for (const wait of delays) {
    if (wait) await new Promise((r) => setTimeout(r, wait));

    const widgetStates = await fetchOzonWidgetStatesInTab(tabId, searchPath);
    if (!widgetStates) continue;

    const offers = parseAllOzonSearchOffers(widgetStates, searchUrl).filter(
      (o) => o.url && !isUrlExcluded(o.url, excludedUrls),
    );
    if (!offers.length) continue;

    const top = pickTopMatchesWithScore(ref, offers, (o) => o.title, {
      referencePrice,
      excludedUrls,
      limit: MAX_CANDIDATE_POOL,
      getPrice: (o) => (o as MarketplaceOffer).price,
      getUrl: (o) => (o as MarketplaceOffer).url,
    });

    if (!top.length) continue;

    const ranked = top.map(({ item, score }) => ({
      offer: item,
      confidence: matchConfidencePercent(score),
    }));

    return buildOfferFromRankedCandidates('ozon', query, searchUrl, ranked);
  }

  return null;
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
