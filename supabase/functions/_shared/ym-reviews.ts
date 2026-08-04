/**
 * Серверный сбор отзывов Яндекс.Маркет (HTML / embedded JSON + Unlocker).
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
    const path = u.pathname.replace(/\/$/, '');
    if (/\/reviews$/i.test(path)) {
      push(`https://market.yandex.ru${path}`);
    } else {
      push(`https://market.yandex.ru${path}/reviews`);
      push(`https://market.yandex.ru${path}`);
    }
  } catch {
    // ignore
  }

  push(`https://market.yandex.ru/product/${productId}/reviews`);
  push(`https://market.yandex.ru/product/${productId}`);
  return out;
}

async function fetchHtmlDirect(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'User-Agent': UA,
        'Accept-Language': 'ru-RU,ru;q=0.9',
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
  return mergeReviewItems(
    extractReviewsFromHtmlJson(html, limit),
    extractReviewsFromHtmlMarkup(html, limit),
  );
}

export async function fetchYandexMarketReviewsServer(
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
