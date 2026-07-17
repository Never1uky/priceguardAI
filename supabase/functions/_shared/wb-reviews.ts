/**
 * Серверный сбор отзывов WB (без DOM) для Telegram / product-intel.
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

export interface WbReviewItem {
  text: string;
  rating?: number;
  author?: string;
}

interface WbFeedbackEntry {
  text?: string;
  pros?: string;
  cons?: string;
  productValuation?: number;
  wbUserDetails?: { name?: string };
  userName?: string;
  name?: string;
}

function parseEntry(entry: WbFeedbackEntry): WbReviewItem | null {
  const text = [entry.text, entry.pros, entry.cons].filter(Boolean).join('. ').trim();
  if (!text || text.length < 5) return null;
  const author =
    entry.wbUserDetails?.name?.trim() ||
    entry.userName?.trim() ||
    entry.name?.trim() ||
    undefined;
  return {
    text,
    rating: entry.productValuation,
    author,
  };
}

function parsePayload(data: unknown, limit: number): WbReviewItem[] {
  if (!data || typeof data !== 'object') return [];
  const record = data as {
    feedbacks?: WbFeedbackEntry[];
    feedbacksData?: { feedbacks?: WbFeedbackEntry[] };
  };
  const feedbacks = record.feedbacks ?? record.feedbacksData?.feedbacks ?? [];
  const out: WbReviewItem[] = [];
  for (const entry of feedbacks) {
    const parsed = parseEntry(entry);
    if (parsed) out.push(parsed);
    if (out.length >= limit) break;
  }
  return out;
}

async function fetchJson(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': UA },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function extractRootFromHtml(html: string): string | null {
  const m =
    html.match(/"root"\s*:\s*(\d{5,})/i) ||
    html.match(/"imt_id"\s*:\s*(\d{5,})/i) ||
    html.match(/"imtId"\s*:\s*(\d{5,})/i);
  return m?.[1] ?? null;
}

async function fetchWbRoot(nmId: string): Promise<string | null> {
  const card = await fetchJson(
    `https://card.wb.ru/cards/v4/detail?appType=1&curr=rub&dest=-1257786&nm=${nmId}`,
  );
  if (card && typeof card === 'object') {
    const products =
      (card as { data?: { products?: Array<{ root?: number; imt_id?: number }> } })
        .data?.products ??
      (card as { products?: Array<{ root?: number; imt_id?: number }> }).products;
    const p = products?.[0];
    const root = p?.root ?? p?.imt_id;
    if (root) return String(root);
  }

  for (const url of [
    `https://www.wildberries.ru/catalog/${nmId}/detail.aspx`,
    `https://www.wildberries.ru/catalog/${nmId}/feedbacks`,
  ]) {
    try {
      const res = await fetch(url, {
        headers: {
          Accept: 'text/html,application/xhtml+xml',
          'User-Agent': UA,
        },
      });
      if (!res.ok) continue;
      const root = extractRootFromHtml(await res.text());
      if (root) return root;
    } catch {
      // next
    }
  }
  return null;
}

export async function fetchWildberriesReviewsServer(
  nmId: string,
  limit = 30,
): Promise<{ reviews: string[]; items: WbReviewItem[]; totalFound: number }> {
  const bare = nmId.replace(/^wb-/i, '').trim();
  if (!bare) return { reviews: [], items: [], totalFound: 0 };

  const root = (await fetchWbRoot(bare)) ?? bare;
  const endpoints = [
    `https://feedbacks1.wb.ru/feedbacks/v1/${bare}?take=${limit}&skip=0&isAnswered=true`,
    `https://feedbacks2.wb.ru/feedbacks/v1/${bare}?take=${limit}&skip=0&isAnswered=true`,
    `https://feedbacks1.wb.ru/feedbacks/v2/${bare}?take=${limit}&skip=0`,
    `https://feedbacks2.wb.ru/feedbacks/v2/${bare}?take=${limit}&skip=0`,
    `https://feedbacks1.wb.ru/feedbacks/v2/${root}?take=${limit}&skip=0`,
    `https://feedbacks2.wb.ru/feedbacks/v2/${root}?take=${limit}&skip=0`,
    `https://feedbacks1.wb.ru/feedbacks/v1/${root}?take=${limit}&skip=0&isAnswered=true`,
    `https://feedbacks2.wb.ru/feedbacks/v1/${root}?take=${limit}&skip=0&isAnswered=true`,
  ];

  for (const endpoint of endpoints) {
    const data = await fetchJson(endpoint);
    if (!data) continue;
    const items = parsePayload(data, limit);
    if (items.length > 0) {
      return {
        reviews: items.map((i) => i.text),
        items,
        totalFound: items.length,
      };
    }
  }

  return { reviews: [], items: [], totalFound: 0 };
}

/** Простая оценка URL картинки WB по nmId. */
export function guessWbImageUrl(nmId: string): string | null {
  const id = Number(nmId.replace(/^wb-/i, ''));
  if (!Number.isFinite(id) || id <= 0) return null;
  const vol = Math.floor(id / 100000);
  const part = Math.floor(id / 1000);
  const ranges: Array<[number, string]> = [
    [143, '01'], [287, '02'], [431, '03'], [719, '04'], [1007, '05'],
    [1061, '06'], [1115, '07'], [1169, '08'], [1313, '09'], [1601, '10'],
    [1655, '11'], [1919, '12'], [2045, '13'], [2189, '14'], [2405, '15'],
    [2621, '16'], [2837, '17'], [3053, '18'], [3269, '19'], [3485, '20'],
    [3701, '21'], [3917, '22'], [4133, '23'], [4349, '24'], [4565, '25'],
    [4877, '26'], [5189, '27'], [5501, '28'], [5813, '29'], [6125, '30'],
    [6437, '31'], [6749, '32'], [7061, '33'], [7373, '34'],
  ];
  let basket = '35';
  for (const [maxVol, host] of ranges) {
    if (vol <= maxVol) {
      basket = host;
      break;
    }
  }
  return `https://basket-${basket}.wbbasket.ru/vol${vol}/part${part}/${id}/images/big/1.webp`;
}
