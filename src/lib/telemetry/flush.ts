/**
 * Opt-in remote flush of WARN/ERROR telemetry → telemetry-ingest / search-metrics.
 * Imports Edge — do not import this module from edge.ts.
 */

import { callEdgeSafe } from '@/lib/supabase/edge';
import type { TelemetryEvent } from './types';
import {
  enqueueRemoteTelemetryLocal,
  readRemoteQueue,
  writeRemoteQueue,
  type QueuedRemote,
} from './remote-queue';

const BATCH = 20;

export async function enqueueRemoteTelemetry(event: TelemetryEvent): Promise<void> {
  await enqueueRemoteTelemetryLocal(event);
  void flushRemoteTelemetry();
}

/** Map a FINAL_RESULT / search summary into legacy search_metrics row. */
export async function reportSearchMetric(input: {
  marketplace: string;
  searchQuery?: string;
  success: boolean;
  responseTimeMs?: number;
  foundProductId?: string | null;
  deviceId?: string | null;
}): Promise<void> {
  const mp = input.marketplace;
  if (mp !== 'wildberries' && mp !== 'ozon' && mp !== 'yandex_market') return;
  void callEdgeSafe('search-metrics', {
    marketplace: mp,
    searchQuery: input.searchQuery ? String(input.searchQuery).slice(0, 300) : null,
    success: input.success,
    responseTimeMs: input.responseTimeMs ?? null,
    foundProductId: input.foundProductId ?? null,
    deviceId: input.deviceId ?? null,
    telemetry: true,
  });
}

let flushing = false;

export async function flushRemoteTelemetry(): Promise<{ sent: number }> {
  if (flushing) return { sent: 0 };
  flushing = true;
  try {
    const q = await readRemoteQueue();
    if (q.length === 0) return { sent: 0 };
    const batch = q.slice(0, BATCH);
    const rest = q.slice(BATCH);

    const batchResult = await callEdgeSafe<{ ok?: boolean }>('telemetry-ingest', {
      events: batch.map((b) => ({
        ts: b.event.ts,
        level: b.event.level,
        stage: b.event.stage,
        name: b.event.name,
        marketplace: b.event.marketplace ?? null,
        productId: b.event.funnel || b.event.ops ? null : (b.event.productId ?? null),
        queryHash: b.event.funnel || b.event.ops ? null : (b.event.queryHash ?? null),
        funnel: Boolean(b.event.funnel),
        ops: Boolean(b.event.ops),
        success: b.event.success ?? null,
        elapsedMs: b.event.elapsedMs ?? null,
        errorCode: b.event.errorCode ?? null,
        errorMessage:
          b.event.funnel || b.event.ops
            ? null
            : (b.event.errorMessage?.slice(0, 300) ?? null),
        extVersion: b.event.extVersion,
        sessionId: b.event.sessionId,
        traceId: b.event.traceId ?? null,
        data: b.event.data ?? null,
      })),
    });

    if (batchResult?.ok) {
      await writeRemoteQueue(rest);
      return { sent: batch.length };
    }

    let sent = 0;
    const failed: QueuedRemote[] = [];
    for (const item of batch) {
      const e = item.event;
      if (e.funnel || e.ops) {
        failed.push(item);
        continue;
      }
      if (e.marketplace === 'wildberries' || e.marketplace === 'ozon' || e.marketplace === 'yandex_market') {
        const r = await callEdgeSafe('search-metrics', {
          marketplace: e.marketplace,
          searchQuery: e.queryHash ?? e.name,
          success: e.success !== false && e.level !== 'error',
          responseTimeMs: e.elapsedMs ?? null,
          foundProductId: e.productId ?? null,
        });
        if (r) sent += 1;
        else failed.push(item);
      } else {
        failed.push(item);
      }
    }
    await writeRemoteQueue([...failed, ...rest].slice(0, 40));
    return { sent };
  } finally {
    flushing = false;
  }
}
