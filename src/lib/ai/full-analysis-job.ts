/**
 * Снимок job полного AI-анализа в session storage —
 * переживает закрытие popup mid-run.
 */

import type { FullProductAnalysis } from '@/types/full-analysis';
import type { FullAnalysisQuotaIntent } from '@/lib/ai/full-analysis-quota-policy';

const JOB_KEY = 'priceguard_full_analysis_job';

export interface FullAnalysisJobSnapshot {
  flightKey: string;
  productId: string;
  productUrl: string;
  intent: FullAnalysisQuotaIntent;
  status: 'running' | 'done' | 'error';
  startedAt: number;
  finishedAt?: number;
  analysis?: FullProductAnalysis;
  fromCache?: boolean;
  quotaConsumed?: boolean;
  cacheNote?: string | null;
  cacheReason?: string | null;
  cacheConfidence?: number | null;
  analysisSource?: string;
  error?: string;
}

export async function setFullAnalysisJobSnapshot(
  job: FullAnalysisJobSnapshot,
): Promise<void> {
  await chrome.storage.session.set({ [JOB_KEY]: job });
}

export async function getFullAnalysisJobSnapshot(): Promise<FullAnalysisJobSnapshot | null> {
  const stored = await chrome.storage.session.get(JOB_KEY);
  return (stored[JOB_KEY] as FullAnalysisJobSnapshot | undefined) ?? null;
}

export async function clearFullAnalysisJobSnapshot(): Promise<void> {
  await chrome.storage.session.remove(JOB_KEY);
}

export function jobMatchesProduct(
  job: FullAnalysisJobSnapshot,
  product: { id?: string; url?: string },
): boolean {
  if (product.id && job.productId && product.id === job.productId) return true;
  if (product.url && job.productUrl) {
    const a = product.url.split('?')[0];
    const b = job.productUrl.split('?')[0];
    return a === b;
  }
  return false;
}
