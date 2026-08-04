/**
 * Pure helpers for multi-product compare running markers (storage shape).
 * Used by compare-jobs + unit tests without chrome.storage.
 */

export type RunningAtMap = Record<string, number>;

export function normalizeRunningIds(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return [...new Set(raw.filter((id): id is string => typeof id === 'string' && id.length > 0))];
  }
  if (typeof raw === 'string' && raw.length > 0) return [raw];
  return [];
}

export function normalizeRunningAtMap(raw: unknown, ids: string[], fallbackTs: number): RunningAtMap {
  const parsed: RunningAtMap = {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v)) parsed[k] = v;
    }
  } else if (typeof raw === 'number' && Number.isFinite(raw) && ids.length === 1) {
    // Legacy single startedAt
    parsed[ids[0]!] = raw;
  }
  const out: RunningAtMap = {};
  for (const id of ids) {
    out[id] = parsed[id] ?? fallbackTs;
  }
  return out;
}

export function addRunningId(
  ids: string[],
  startedAt: RunningAtMap,
  productId: string,
  nowMs: number,
): { ids: string[]; startedAt: RunningAtMap } {
  const nextIds = ids.includes(productId) ? [...ids] : [...ids, productId];
  return {
    ids: nextIds,
    startedAt: { ...startedAt, [productId]: nowMs },
  };
}

export function removeRunningId(
  ids: string[],
  startedAt: RunningAtMap,
  productId: string,
): { ids: string[]; startedAt: RunningAtMap } {
  const nextIds = ids.filter((id) => id !== productId);
  const nextAt = { ...startedAt };
  delete nextAt[productId];
  return { ids: nextIds, startedAt: nextAt };
}

/** Drop entries older than staleMs; returns surviving ids + map. */
export function pruneStaleRunning(
  ids: string[],
  startedAt: RunningAtMap,
  nowMs: number,
  staleMs: number,
): { ids: string[]; startedAt: RunningAtMap; pruned: string[] } {
  const pruned: string[] = [];
  const nextIds: string[] = [];
  const nextAt: RunningAtMap = {};
  for (const id of ids) {
    const t = startedAt[id];
    if (t != null && nowMs - t > staleMs) {
      pruned.push(id);
      continue;
    }
    nextIds.push(id);
    if (t != null) nextAt[id] = t;
  }
  return { ids: nextIds, startedAt: nextAt, pruned };
}

export function keepAliveShouldStart(activeJobCount: number): boolean {
  return activeJobCount === 1;
}

export function keepAliveShouldStop(activeJobCount: number): boolean {
  return activeJobCount <= 0;
}
