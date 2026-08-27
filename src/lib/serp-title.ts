/** Reject promo/badge lines mistaken for product titles on SERP tiles. */

const PROMO_TITLE =
  /^\d+\s*балл|баллов|скидк|доставк|завтра|рассроч|кэшбэк|купон|акци|распрод|осталось\s*\d|рекомен|хит\b|новинк|выбор\s+покупател|^\d+\s*шт\.?\s*$/i;

/** Badge-only lines Ozon often puts in link text instead of product name. */
const OZON_BADGE_ONLY =
  /^(?:распрод(?:ажа)?|рекомен(?:дуем)?|осталось\s+\d+\s*шт\.?|хит|новинка|вы\s*год\s*выбираете)$/i;

export function isPromoSerpTitle(title: string | null | undefined): boolean {
  const t = title?.trim() ?? '';
  if (!t) return true;
  if (/^\d+\s*балл/i.test(t)) return true;
  if (OZON_BADGE_ONLY.test(t)) return true;
  if (/^осталось\s+\d+/i.test(t)) return true;
  if (/^распрод/i.test(t) && t.length < 32) return true;
  if (/^рекомен/i.test(t) && t.length < 32) return true;
  if (PROMO_TITLE.test(t) && t.length < 48 && !/\b(?:canon|nikon|sony|fuji|eos|iphone|samsung|nike|adidas|xiaomi|redmi|trace)\b/i.test(t)) {
    return true;
  }
  if (t.length < 6 && !/[a-zа-яё]{4,}/i.test(t)) return true;
  if (t.length < 24 && !/\s/.test(t) && /^(?:распрод|рекомен|хит|новин)/i.test(t)) return true;
  return false;
}

/** Decode marketplace slug segments into a readable title. */
function slugSegmentsToTitle(slug: string): string | null {
  const normalized = slug.replace(/--/g, '-').replace(/-\d{5,}$/i, '');
  const words = normalized
    .split('-')
    .map((w) => w.trim())
    .filter((w) => w.length > 0 && !/^\d{5,}$/.test(w));

  if (words.length < 2) return null;

  const title = words
    .map((w) => (/^[a-z]{1,3}\d/i.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');

  if (title.length < 8 || isPromoSerpTitle(title)) return null;
  return title.slice(0, 200);
}

/** Derive a readable title from product URL slug (Ozon, Yandex Market, etc.). */
export function titleFromProductUrl(url: string | null | undefined): string | null {
  if (!url?.trim()) return null;

  const ozonMatch = url.match(/\/product\/([^/?#]+)/i);
  if (ozonMatch?.[1]) return slugSegmentsToTitle(ozonMatch[1]);

  if (/market\.yandex/i.test(url)) {
    const ymMatch = url.match(/\/(?:card|product)\/([^/?#]+)/i);
    if (ymMatch?.[1]) return slugSegmentsToTitle(ymMatch[1]);
  }

  if (/megamarket\.ru|sbermegamarket\.ru/i.test(url)) {
    const megaMatch = url.match(/\/catalog\/details\/([^/?#]+)/i);
    if (megaMatch?.[1]) return slugSegmentsToTitle(megaMatch[1]);
  }

  return null;
}

function placeholderFromUrl(url?: string): string {
  if (!url) return 'Товар';
  if (/ozon\.ru/i.test(url)) return 'Товар на Ozon';
  if (/wildberries/i.test(url)) return 'Товар на Wildberries';
  if (/market\.yandex/i.test(url)) return 'Товар на Я.Маркете';
  if (/megamarket\.ru|sbermegamarket\.ru/i.test(url)) return 'Товар на Мегамаркете';
  return 'Товар';
}

/** Placeholder / empty SERP titles must not enter match scoring as the search query. */
export function isPlaceholderSerpTitle(title: string | null | undefined): boolean {
  const t = title?.trim() ?? '';
  if (!t) return true;
  if (/^товар(?:\s+на\s+\S+)?$/i.test(t)) return true;
  return false;
}

export function sanitizeSerpTitle(
  title: string,
  containerText?: string,
  url?: string,
): string {
  const trimmed = title.trim();
  if (trimmed && !isPromoSerpTitle(trimmed)) return trimmed.slice(0, 200);

  if (containerText) {
    const lines = containerText
      .split(/[\n|•]/)
      .map((l) => l.trim())
      .filter((l) => l.length >= 8 && !isPromoSerpTitle(l));
    const best = lines.sort((a, b) => b.length - a.length)[0];
    if (best) return best.slice(0, 200);
  }

  const fromUrl = titleFromProductUrl(url);
  if (fromUrl) return fromUrl;

  if (!trimmed || isPromoSerpTitle(trimmed)) {
    return placeholderFromUrl(url);
  }

  return trimmed.slice(0, 200);
}

/** Sanitize candidate title for searchCandidates UI and scoring hints. */
export function sanitizeCandidateTitle(
  title: string,
  containerText?: string,
  url?: string,
): string {
  return sanitizeSerpTitle(title, containerText, url);
}

/** Prefer card title, then sanitized SERP/slug for picker UI. */
export function resolveCandidateDisplayTitle(opts: {
  serpTitle?: string;
  cardTitle?: string;
  containerText?: string;
  url?: string;
}): string {
  const card = opts.cardTitle?.trim();
  if (card && !isPromoSerpTitle(card)) return card.slice(0, 200);
  return sanitizeCandidateTitle(opts.serpTitle ?? '', opts.containerText, opts.url);
}

export function pickSerpTitleFromTile(opts: {
  linkTitle?: string | null;
  ariaLabel?: string | null;
  headline?: string | null;
  linkText?: string | null;
  containerText?: string | null;
  fallback: string;
  url?: string | null;
}): string {
  const candidates = [
    opts.headline,
    opts.linkTitle,
    opts.ariaLabel,
    opts.linkText,
  ].filter((c): c is string => Boolean(c?.trim()));

  for (const c of candidates) {
    if (!isPromoSerpTitle(c)) return c.trim().slice(0, 200);
  }

  return sanitizeSerpTitle(
    opts.linkText ?? opts.fallback,
    opts.containerText ?? undefined,
    opts.url ?? undefined,
  );
}
