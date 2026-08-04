/**
 * Offline queue for failed compare candidate picks (network).
 * Cap 12; exponential backoff 1m → 5m → 15m; drop after 3 failed attempts.
 */
import type { ComparisonMarketplace } from '@/types/comparison';

const QUEUE_KEY = 'priceguard_pick_retry_queue';
const MAX_ITEMS = 12;
const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000] as const;

export interface PickRetryItem {
  productId: string;
  marketplace: ComparisonMarketplace;
  url: string;
  title?: string;
  price?: number | null;
  at: number;
  /** Failed drain attempts (0 = never tried after enqueue). */
  attempts: number;
  /** Earliest time this item may be drained again. */
  nextAt: number;
}

function normalizeItem(raw: Partial<PickRetryItem> & PickRetryItem): PickRetryItem {
  return {
    productId: raw.productId,
    marketplace: raw.marketplace,
    url: raw.url,
    title: raw.title,
    price: raw.price,
    at: raw.at ?? Date.now(),
    attempts: typeof raw.attempts === 'number' ? raw.attempts : 0,
    nextAt: typeof raw.nextAt === 'number' ? raw.nextAt : raw.at ?? Date.now(),
  };
}

export async function enqueuePickRetry(
  item: Omit<PickRetryItem, 'at' | 'attempts' | 'nextAt'>,
): Promise<void> {
  const stored = await chrome.storage.local.get(QUEUE_KEY);
  const list = Array.isArray(stored[QUEUE_KEY])
    ? (stored[QUEUE_KEY] as Partial<PickRetryItem>[]).map((x) =>
        normalizeItem(x as PickRetryItem),
      )
    : [];
  const filtered = list.filter(
    (x) => !(x.productId === item.productId && x.marketplace === item.marketplace && x.url === item.url),
  );
  const now = Date.now();
  filtered.unshift({
    ...item,
    at: now,
    attempts: 0,
    nextAt: now,
  });
  await chrome.storage.local.set({ [QUEUE_KEY]: filtered.slice(0, MAX_ITEMS) });
}

export async function peekPickRetryQueue(): Promise<PickRetryItem[]> {
  const stored = await chrome.storage.local.get(QUEUE_KEY);
  if (!Array.isArray(stored[QUEUE_KEY])) return [];
  return (stored[QUEUE_KEY] as Partial<PickRetryItem>[]).map((x) =>
    normalizeItem(x as PickRetryItem),
  );
}

/** Items ready to drain (nextAt <= now), oldest-first among due. */
export async function peekDuePickRetries(limit = 3): Promise<PickRetryItem[]> {
  const now = Date.now();
  const list = await peekPickRetryQueue();
  return list.filter((x) => x.nextAt <= now).slice(0, limit);
}

export async function dequeuePickRetry(item: PickRetryItem): Promise<void> {
  const list = await peekPickRetryQueue();
  await chrome.storage.local.set({
    [QUEUE_KEY]: list.filter(
      (x) =>
        !(x.productId === item.productId && x.marketplace === item.marketplace && x.url === item.url),
    ),
  });
}

/** Record a failed drain: bump attempts + schedule nextAt, or drop. */
export async function markPickRetryFailure(item: PickRetryItem): Promise<void> {
  const list = await peekPickRetryQueue();
  const next: PickRetryItem[] = [];
  for (const x of list) {
    if (
      !(x.productId === item.productId && x.marketplace === item.marketplace && x.url === item.url)
    ) {
      next.push(x);
      continue;
    }
    const attempts = x.attempts + 1;
    if (attempts >= MAX_ATTEMPTS) continue; // drop
    const delay = BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)]!;
    next.push({
      ...x,
      attempts,
      nextAt: Date.now() + delay,
    });
  }
  await chrome.storage.local.set({ [QUEUE_KEY]: next.slice(0, MAX_ITEMS) });
}
