/**
 * Local history of manual compare picks — boosts future ranking.
 */
import { normalizeCompareUrl } from '@/utils/comparison-url';
import type { ComparisonMarketplace } from '@/types/comparison';
import type { PickMatchOptions } from '@/lib/product-match';

const STORAGE_KEY = 'priceguard_pick_history';
const MAX_PER_MODEL = 5;

/** Raw boost 0–5 from getPickHistoryBoost → additive score delta (max +0.05). */
export const PICK_HISTORY_SCORE_SCALE = 0.01;

export interface PickHistoryEntry {
  marketplace: ComparisonMarketplace;
  url: string;
  title: string;
  at: number;
}

type HistoryStore = Record<string, PickHistoryEntry[]>;

function modelKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter((t) => t.length > 2)
    .slice(0, 6)
    .join(' ');
}

async function readStore(): Promise<HistoryStore> {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const raw = stored[STORAGE_KEY];
  return raw && typeof raw === 'object' ? (raw as HistoryStore) : {};
}

export async function rememberPickHistory(input: {
  referenceTitle: string;
  marketplace: ComparisonMarketplace;
  url: string;
  title: string;
}): Promise<void> {
  const key = modelKey(input.referenceTitle || input.title);
  if (!key) return;
  const store = await readStore();
  const list = (store[key] ?? []).filter((e) => e.url !== input.url);
  list.unshift({
    marketplace: input.marketplace,
    url: input.url,
    title: input.title,
    at: Date.now(),
  });
  store[key] = list.slice(0, MAX_PER_MODEL);
  await chrome.storage.local.set({ [STORAGE_KEY]: store });
}

/** 0–5 boost if candidate URL/title matches recent picks for this model */
export async function getPickHistoryBoost(
  referenceTitle: string,
  marketplace: ComparisonMarketplace,
  candidateUrl: string,
  candidateTitle?: string,
): Promise<number> {
  const key = modelKey(referenceTitle);
  if (!key) return 0;
  const store = await readStore();
  const list = store[key] ?? [];
  if (!list.length) return 0;

  const urlNorm = candidateUrl.toLowerCase();
  const titleNorm = (candidateTitle ?? '').toLowerCase();

  for (let i = 0; i < list.length; i++) {
    const e = list[i]!;
    if (e.marketplace !== marketplace) continue;
    if (e.url.toLowerCase() === urlNorm || urlNorm.includes(e.url.toLowerCase())) {
      return Math.max(2, 5 - i);
    }
    if (titleNorm && e.title.toLowerCase() && titleNorm.includes(e.title.toLowerCase().slice(0, 24))) {
      return Math.max(1, 3 - i);
    }
  }
  return 0;
}

export function pickHistoryBoostToScoreDelta(boost: number): number {
  if (boost <= 0) return 0;
  return boost * PICK_HISTORY_SCORE_SCALE;
}

/** Build URL→scoreDelta map for pickTopMatchesWithScore / pickBestMatchWithScore. */
export async function buildPickHistoryBoostMap(
  referenceTitle: string,
  marketplace: ComparisonMarketplace,
  entries: Array<{ url: string; title?: string }>,
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (!referenceTitle || referenceTitle === 'Товар' || !entries.length) return map;

  await Promise.all(
    entries.map(async ({ url, title }) => {
      if (!url) return;
      const raw = await getPickHistoryBoost(referenceTitle, marketplace, url, title);
      if (raw <= 0) return;
      const delta = pickHistoryBoostToScoreDelta(raw);
      map.set(url.toLowerCase(), delta);
      try {
        map.set(normalizeCompareUrl(url).toLowerCase(), delta);
      } catch {
        // keep direct url key only
      }
    }),
  );

  return map;
}

/** Attach local pick-history boosts to SERP ranking options (async prefetch). */
export async function attachPickHistoryBoosts<T>(
  referenceTitle: string,
  marketplace: ComparisonMarketplace,
  candidates: T[],
  options: PickMatchOptions & { getUrl?: (item: T) => string | undefined },
  getTitle: (item: T) => string,
): Promise<PickMatchOptions & { getUrl?: (item: T) => string | undefined }> {
  if (!referenceTitle || referenceTitle === 'Товар' || !options.getUrl) return options;

  const entries = candidates
    .map((candidate) => {
      const url = options.getUrl!(candidate);
      if (!url) return null;
      return { url, title: getTitle(candidate) };
    })
    .filter((entry): entry is { url: string; title: string } => Boolean(entry));

  const scoreBoostByUrl = await buildPickHistoryBoostMap(referenceTitle, marketplace, entries);
  if (!scoreBoostByUrl.size) return options;

  return { ...options, scoreBoostByUrl };
}
