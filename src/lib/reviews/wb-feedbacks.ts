/** Чистые функции парсинга отзывов WB — тестируемые без DOM. */

export interface WbReviewItem {
  text: string;
  rating?: number;
  hasPhoto?: boolean;
  timestamp?: number;
  /** Имя автора, если API вернул */
  author?: string;
}

export interface WbFeedbackEntry {
  text?: string;
  pros?: string;
  cons?: string;
  productValuation?: number;
  photo?: unknown[];
  photos?: unknown[];
  createdDate?: string;
  createdDateTime?: string;
  wbUserDetails?: { name?: string };
  userName?: string;
  name?: string;
}

export function parseWbFeedbackEntry(entry: WbFeedbackEntry): WbReviewItem | null {
  const text = [entry.text, entry.pros, entry.cons].filter(Boolean).join('. ').trim();
  if (!text || text.length < 5) return null;

  const dateStr = entry.createdDate ?? entry.createdDateTime;
  const timestamp = dateStr ? Date.parse(dateStr) : undefined;

  const author =
    entry.wbUserDetails?.name?.trim() ||
    entry.userName?.trim() ||
    entry.name?.trim() ||
    undefined;

  return {
    text,
    rating: entry.productValuation,
    hasPhoto: Boolean(entry.photo?.length || entry.photos?.length),
    timestamp: timestamp && !Number.isNaN(timestamp) ? timestamp : undefined,
    author,
  };
}

export function parseWbFeedbacksPayload(data: unknown, limit = 30): WbReviewItem[] {
  if (!data || typeof data !== 'object') return [];

  const record = data as {
    feedbacks?: WbFeedbackEntry[];
    feedbacksData?: { feedbacks?: WbFeedbackEntry[] };
  };

  const feedbacks = record.feedbacks ?? record.feedbacksData?.feedbacks ?? [];
  const results: WbReviewItem[] = [];

  for (const entry of feedbacks) {
    const parsed = parseWbFeedbackEntry(entry);
    if (parsed) results.push(parsed);
    if (results.length >= limit) break;
  }

  return results;
}
