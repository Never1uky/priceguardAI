/**
 * Лёгкая телеметрия pipeline: HiddenBrowser rate, AI cache hits.
 * Хранится локально; опционально можно слать в search-metrics позже.
 */

const KEY = 'priceguard_pipeline_metrics';

export interface PipelineMetrics {
  hiddenBrowserAttempts: number;
  hiddenBrowserSuccess: number;
  apiSearchSuccess: number;
  mappingHits: number;
  aiCacheLocalHits: number;
  aiCacheRemoteHits: number;
  aiCacheMisses: number;
  aiCloudRuns: number;
  updatedAt: number;
}

const EMPTY: PipelineMetrics = {
  hiddenBrowserAttempts: 0,
  hiddenBrowserSuccess: 0,
  apiSearchSuccess: 0,
  mappingHits: 0,
  aiCacheLocalHits: 0,
  aiCacheRemoteHits: 0,
  aiCacheMisses: 0,
  aiCloudRuns: 0,
  updatedAt: 0,
};

async function read(): Promise<PipelineMetrics> {
  try {
    const stored = await chrome.storage.local.get(KEY);
    return { ...EMPTY, ...(stored[KEY] as Partial<PipelineMetrics> | undefined) };
  } catch {
    return { ...EMPTY };
  }
}

async function bump(patch: Partial<PipelineMetrics>): Promise<void> {
  try {
    const cur = await read();
    const next: PipelineMetrics = { ...cur, updatedAt: Date.now() };
    for (const [k, v] of Object.entries(patch) as Array<[keyof PipelineMetrics, number | undefined]>) {
      if (k === 'updatedAt' || v === undefined) continue;
      if (typeof v === 'number') {
        next[k] = ((cur[k] as number) ?? 0) + v;
      }
    }
    await chrome.storage.local.set({ [KEY]: next });
  } catch {
    // metrics must never break product flow
  }
}

export const pipelineMetrics = {
  hiddenBrowserAttempt: () => bump({ hiddenBrowserAttempts: 1 }),
  hiddenBrowserSuccess: () => bump({ hiddenBrowserSuccess: 1 }),
  apiSearchSuccess: () => bump({ apiSearchSuccess: 1 }),
  mappingHit: () => bump({ mappingHits: 1 }),
  aiCacheLocalHit: () => bump({ aiCacheLocalHits: 1 }),
  aiCacheRemoteHit: () => bump({ aiCacheRemoteHits: 1 }),
  aiCacheMiss: () => bump({ aiCacheMisses: 1 }),
  aiCloudRun: () => bump({ aiCloudRuns: 1 }),
  get: read,
};
