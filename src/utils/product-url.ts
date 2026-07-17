import type { Marketplace } from '@/types/product';
import { buildWildberriesUrl, detectMarketplace } from '@/utils/marketplace';

const WB_FEEDBACKS = /\/feedbacks(?:\/|$)/i;

export function isWildberriesFeedbacksUrl(url: string): boolean {
  return /wildberries\.ru/i.test(url) && WB_FEEDBACKS.test(url);
}

/** Страница отзывов WB для фонового парсинга. */
export function toWildberriesFeedbacksUrl(nmIdOrUrl: string): string {
  const match = nmIdOrUrl.match(/\/catalog\/(\d+)/i) ?? nmIdOrUrl.match(/^(\d{5,})$/);
  const nmId = match?.[1] ?? nmIdOrUrl.replace(/\D/g, '');
  return `https://www.wildberries.ru/catalog/${nmId}/feedbacks`;
}

/** Карточка товара без query, без /feedbacks и с detail.aspx для WB. */
export function toCanonicalProductUrl(url: string, marketplace?: Marketplace | null): string {
  const mp = marketplace ?? detectMarketplace(url);
  if (!mp) {
    return url.split('?')[0].split('#')[0];
  }

  try {
    const parsed = new URL(url.trim());
    const path = parsed.pathname.replace(/\/$/, '');

    if (mp === 'wildberries') {
      const match = path.match(/\/catalog\/(\d+)/i);
      if (match?.[1] && match[1] !== '0') {
        if (WB_FEEDBACKS.test(path) || !/\/detail/i.test(path)) {
          return buildWildberriesUrl(match[1]);
        }
        return `${parsed.origin}${path}`;
      }
    }

    return `${parsed.origin}${path}`;
  } catch {
    return url.split('?')[0].split('#')[0];
  }
}

export function offerLinkUrl(url: string, marketplace?: Marketplace): string {
  if (!url) return url;
  if (isWildberriesFeedbacksUrl(url)) {
    return toCanonicalProductUrl(url, marketplace ?? 'wildberries');
  }
  const mp = marketplace ?? detectMarketplace(url);
  if (mp && !/\/search|search\.aspx|text=/i.test(url)) {
    return toCanonicalProductUrl(url, mp);
  }
  return url;
}
