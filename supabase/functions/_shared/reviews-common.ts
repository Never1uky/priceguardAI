/**
 * Общие типы и JSON-walk для серверного извлечения отзывов.
 */

export interface ServerReviewItem {
  text: string;
  rating?: number;
}

export interface ServerReviewsResult {
  reviews: string[];
  items: ServerReviewItem[];
  totalFound: number;
}

export function emptyReviews(): ServerReviewsResult {
  return { reviews: [], items: [], totalFound: 0 };
}

function inferRating(text: string): number {
  const lower = text.toLowerCase();
  if (/плох|брак|ужас|не рекоменд|сломал|дефект|вернул|обман/.test(lower)) return 2;
  if (/отличн|супер|рекоменд/.test(lower)) return 5;
  return 4;
}

export function walkJsonForReviews(
  root: unknown,
  limit = 40,
): ServerReviewItem[] {
  const seen = new Set<string>();
  const results: ServerReviewItem[] = [];

  const tryPush = (text: unknown, rating?: unknown) => {
    if (typeof text !== 'string') return;
    const trimmed = text.trim();
    if (trimmed.length < 15 || trimmed.length > 2000 || seen.has(trimmed)) return;
    // Отсекаем явный мусор UI
    if (/cookie|подписк|войти|регистрац/i.test(trimmed) && trimmed.length < 40) return;
    seen.add(trimmed);
    const numRating =
      typeof rating === 'number' && rating >= 1 && rating <= 5
        ? rating
        : typeof rating === 'string'
          ? Number.parseFloat(rating.replace(',', '.'))
          : undefined;
    const ratingOk =
      numRating != null && Number.isFinite(numRating) && numRating >= 1 && numRating <= 5
        ? numRating
        : inferRating(trimmed);
    results.push({ text: trimmed, rating: ratingOk });
  };

  const walk = (node: unknown, depth = 0): void => {
    if (!node || typeof node !== 'object' || depth > 16 || results.length >= limit) return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    const obj = node as Record<string, unknown>;
    const text =
      obj.text ??
      obj.comment ??
      obj.body ??
      obj.reviewText ??
      obj.fullText ??
      obj.content ??
      obj.reviewBody ??
      obj.description;
    const rating = obj.rating ?? obj.grade ?? obj.score ?? obj.stars ?? obj.productValuation;
    if (typeof text === 'string') tryPush(text, rating);
    for (const value of Object.values(obj)) walk(value, depth + 1);
  };

  walk(root);
  return results;
}

/** Извлечь JSON из script-тегов и __NEXT_DATA__ в HTML. */
export function extractReviewsFromHtmlJson(html: string, limit = 40): ServerReviewItem[] {
  const items: ServerReviewItem[] = [];
  const seen = new Set<string>();

  const pushAll = (parsed: unknown) => {
    for (const item of walkJsonForReviews(parsed, limit)) {
      if (seen.has(item.text)) continue;
      seen.add(item.text);
      items.push(item);
      if (items.length >= limit) return;
    }
  };

  const scriptRe =
    /<script[^>]+type=["']application\/(?:ld\+)?json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = scriptRe.exec(html)) !== null) {
    try {
      pushAll(JSON.parse(m[1]!.trim()));
    } catch {
      // ignore
    }
    if (items.length >= limit) break;
  }

  const next = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (next?.[1] && items.length < limit) {
    try {
      pushAll(JSON.parse(next[1].trim()));
    } catch {
      // ignore
    }
  }

  // Большие JSON-блоки в widgetStates / state
  const stateRe = /"(?:widgetStates|reviews|feedbacks)"\s*:\s*(\{[\s\S]{20,500000}?)\s*(?:,\s*"|\}\s*;)/g;
  while ((m = stateRe.exec(html)) !== null && items.length < limit) {
    try {
      pushAll(JSON.parse(m[1]!));
    } catch {
      // ignore
    }
  }

  return items.slice(0, limit);
}

/** itemprop=reviewBody и похожие куски текста из HTML. */
export function extractReviewsFromHtmlMarkup(html: string, limit = 40): ServerReviewItem[] {
  const seen = new Set<string>();
  const items: ServerReviewItem[] = [];

  const patterns = [
    /itemprop=["']reviewBody["'][^>]*>([\s\S]*?)<\//gi,
    /data-auto=["']review-text["'][^>]*>([\s\S]*?)<\//gi,
    /data-review-uuid=["'][^"']+["'][^>]*>([\s\S]*?)<\//gi,
    /"reviewText"\s*:\s*"((?:\\.|[^"\\]){15,2000})"/gi,
    /"text"\s*:\s*"((?:\\.|[^"\\]){40,2000})"/gi,
  ];

  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null && items.length < limit) {
      let raw = m[1] ?? '';
      raw = raw
        .replace(/<[^>]+>/g, ' ')
        .replace(/\\n/g, ' ')
        .replace(/\\"/g, '"')
        .replace(/&nbsp;/g, ' ')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, ' ')
        .trim();
      if (raw.length < 15 || raw.length > 2000 || seen.has(raw)) continue;
      if (/^{|function |window\./i.test(raw)) continue;
      seen.add(raw);
      items.push({ text: raw, rating: inferRating(raw) });
    }
  }

  return items;
}

export function mergeReviewItems(
  ...groups: ServerReviewItem[][]
): ServerReviewsResult {
  const seen = new Set<string>();
  const items: ServerReviewItem[] = [];
  for (const group of groups) {
    for (const item of group) {
      if (seen.has(item.text)) continue;
      seen.add(item.text);
      items.push(item);
    }
  }
  return {
    reviews: items.map((i) => i.text),
    items,
    totalFound: items.length,
  };
}

export function projectScraperCredentials(): { apiKey: string; zone: string } | null {
  const apiKey = Deno.env.get('BRIGHTDATA_API_KEY')?.trim() ?? '';
  const zone = Deno.env.get('BRIGHTDATA_ZONE')?.trim() ?? '';
  if (!apiKey || !zone) return null;
  return { apiKey, zone };
}
