/**
 * Local-only remote outbox (no Edge import — safe from SW emit path).
 * Network flush lives in flush.ts.
 */

import type { TelemetryEvent } from './types';

export const REMOTE_QUEUE_KEY = 'priceguard_telemetry_remote_queue_v1';
const MAX_QUEUE = 40;

export interface QueuedRemote {
  id: string;
  event: TelemetryEvent;
  enqueuedAt: number;
}

export async function readRemoteQueue(): Promise<QueuedRemote[]> {
  try {
    const stored = await chrome.storage.local.get(REMOTE_QUEUE_KEY);
    const list = stored[REMOTE_QUEUE_KEY];
    return Array.isArray(list) ? (list as QueuedRemote[]) : [];
  } catch {
    return [];
  }
}

export async function writeRemoteQueue(items: QueuedRemote[]): Promise<void> {
  try {
    await chrome.storage.local.set({ [REMOTE_QUEUE_KEY]: items.slice(0, MAX_QUEUE) });
  } catch {
    // ignore
  }
}

/** Enqueue WARN/ERROR, opt-in funnel INFO, or ops INFO for later network flush (storage only). */
export async function enqueueRemoteTelemetryLocal(event: TelemetryEvent): Promise<void> {
  const funnelInfo = event.funnel && event.level === 'info';
  const opsInfo = event.ops && event.level === 'info';
  if (event.level !== 'warn' && event.level !== 'error' && !funnelInfo && !opsInfo) return;
  const q = await readRemoteQueue();
  q.unshift({
    id: event.id,
    event,
    enqueuedAt: Date.now(),
  });
  await writeRemoteQueue(q);
}
