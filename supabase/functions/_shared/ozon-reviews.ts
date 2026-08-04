/**
 * Серверный сбор отзывов Ozon (Unlocker HTML + JSON/markup extract).
 */

import { fetchViaScrappey, type ScraperCredentials } from './scrappey.ts';
import {
  emptyReviews,
  extractReviewsFromHtmlJson,
  extractReviewsFromHtmlMarkup,
  mergeReviewItems,
  type ServerReviewsResult,
} from './reviews-common.ts';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

function reviewsUrlCandidates(productUrl: string, productId: string): string[] {
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
    push(`https://www.ozon.ru${path}?reviews=1`);
  } catch {
    // ignore
  }

  push(`https://www.ozon.ru/product/${productId}/`);
  push(`https://www.ozon.ru/product/${productId}/?reviews=1`);
  return out;
}

async function fetchHtmlDirect(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'User-Agent': UA,
        'Accept-Language': 'ru-RU,ru;q=0.9',
        Referer: 'https://www.ozon.ru/',
      },
    });
    if (!res.ok) return null;
    const html = await res.text();
    return html.length > 500 ? html : null;
  } catch {
    return null;
  }
}

function parseHtml(html: string, limit: number): ServerReviewsResult {
  // Ozon часто кладёт виджеты в widgetStates как JSON-строки
  const fromWidgets: ReturnType<typeof extractReviewsFromHtmlJson> = [];
  const widgetRe = /"widgetStates"\s*:\s*\{([\s\S]*?)\}\s*,\s*"/;
  const wm = html.match(widgetRe);
  if (wm?.[1]) {
    const inner = `{${wm[1]}}`;
    try {
      const states = JSON.parse(inner) as Record<string, string>;
      for (const raw of Object.values(states)) {
        if (typeof raw !== 'string' || raw.length < 20) continue;
        if (!/review|отзыв|webListReviews|webReview/i.test(raw)) continue;
        try {
          fromWidgets.push(...extractReviewsFromHtmlJson(raw, limit));
          const parsed = JSON.parse(raw) as unknown;
          fromWidgets.push(
            ...extractReviewsFromHtmlJson(JSON.stringify(parsed), limit),
          );
        } catch {
          fromWidgets.push(...extractReviewsFromHtmlMarkup(raw, limit));
        }
      }
    } catch {
      // ignore
    }
  }

  return mergeReviewItems(
    fromWidgets,
    extractReviewsFromHtmlJson(html, limit),
    extractReviewsFromHtmlMarkup(html, limit),
  );
}

export async function fetchOzonReviewsServer(
  productId: string,
  productUrl: string,
  limit = 40,
  scraper?: ScraperCredentials | null,
): Promise<ServerReviewsResult> {
  const candidates = reviewsUrlCandidates(productUrl, productId);

  for (const url of candidates) {
    if (scraper) {
      const unlocked = await fetchViaScrappey(url, scraper, { country: 'ru' });
      if (unlocked.html) {
        const parsed = parseHtml(unlocked.html, limit);
        if (parsed.totalFound > 0) return parsed;
      }
    }

    const direct = await fetchHtmlDirect(url);
    if (direct) {
      const parsed = parseHtml(direct, limit);
      if (parsed.totalFound > 0) return parsed;
    }
  }

  return emptyReviews();
}
