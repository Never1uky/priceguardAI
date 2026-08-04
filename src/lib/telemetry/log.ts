/**
 * Local telemetry emit (ring + console). No Edge imports — safe for SW + edge.ts.
 */

import {
  ensureSessionId,
  getBrowserLabel,
  getExtensionVersion,
  getSessionIdSync,
  getTelemetryContext,
  loadTelemetrySettings,
} from './context';
import { redactData } from './redact';
import { appendTelemetryEvent } from './ring';
import { shouldConsoleLog, shouldStoreLevel } from './sample';
import { enqueueRemoteTelemetryLocal } from './remote-queue';
import type {
  TelemetryContextPatch,
  TelemetryEvent,
  TelemetryLevel,
  TelemetryStage,
} from './types';
import { pipelineMetrics } from '@/lib/pipeline-metrics';

export interface TelemetryLogInput {
  stage: TelemetryStage;
  name: string;
  marketplace?: string;
  productId?: string;
  queryHash?: string;
  success?: boolean;
  elapsedMs?: number;
  errorCode?: string;
  errorMessage?: string;
  data?: Record<string, unknown>;
  error?: unknown;
  ctx?: TelemetryContextPatch;
}

function newEventId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function stackFromError(err: unknown): string | undefined {
  if (err instanceof Error && err.stack) return err.stack.slice(0, 1500);
  return undefined;
}

function messageFromError(err: unknown): string | undefined {
  if (err instanceof Error) return err.message.slice(0, 400);
  if (typeof err === 'string') return err.slice(0, 400);
  return undefined;
}

async function emit(level: TelemetryLevel, input: TelemetryLogInput): Promise<void> {
  try {
    await ensureSessionId();
    const settings = await loadTelemetrySettings();
    if (!shouldStoreLevel(level, settings.mode) && !shouldConsoleLog(level, settings.mode)) {
      return;
    }

    const ambient = getTelemetryContext();
    const ctx = { ...ambient, ...input.ctx };
    const event: TelemetryEvent = {
      id: newEventId(),
      ts: Date.now(),
      level,
      stage: input.stage,
      name: input.name,
      sessionId: getSessionIdSync(),
      traceId: ctx.traceId,
      jobId: ctx.jobId,
      userId: ctx.userId,
      extVersion: getExtensionVersion(),
      browser: getBrowserLabel(),
      marketplace: input.marketplace ?? ctx.marketplace,
      productId: input.productId ?? ctx.productId,
      queryHash: input.queryHash ?? ctx.queryHash,
      success: input.success,
      elapsedMs: input.elapsedMs,
      errorCode: input.errorCode,
      errorMessage: input.errorMessage ?? messageFromError(input.error),
      data: redactData(input.data),
      stack: level === 'error' ? stackFromError(input.error) : undefined,
    };

    if (shouldStoreLevel(level, settings.mode)) {
      appendTelemetryEvent(event);
      if (settings.remoteEnabled && (level === 'warn' || level === 'error')) {
        void enqueueRemoteTelemetryLocal(event);
      }
    }

    if (shouldConsoleLog(level, settings.mode)) {
      const prefix = `[PriceGuard:tel] ${event.stage}/${event.name}`;
      if (level === 'error') console.warn(prefix, event.errorMessage ?? event.data ?? '');
      else if (level === 'warn') console.warn(prefix, event.errorMessage ?? event.data ?? '');
      else console.info(prefix, event.data ?? '');
    }
  } catch {
    // telemetry must never break product flow
  }
}

type MetricBump =
  | 'hiddenBrowserAttempt'
  | 'hiddenBrowserSuccess'
  | 'apiSearchSuccess'
  | 'mappingHit'
  | 'aiCacheLocalHit'
  | 'aiCacheRemoteHit'
  | 'aiCacheMiss'
  | 'aiCloudRun';

function applyMetricBump(bump: MetricBump): void {
  switch (bump) {
    case 'hiddenBrowserAttempt':
      void pipelineMetrics.hiddenBrowserAttempt();
      break;
    case 'hiddenBrowserSuccess':
      void pipelineMetrics.hiddenBrowserSuccess();
      break;
    case 'apiSearchSuccess':
      void pipelineMetrics.apiSearchSuccess();
      break;
    case 'mappingHit':
      void pipelineMetrics.mappingHit();
      break;
    case 'aiCacheLocalHit':
      void pipelineMetrics.aiCacheLocalHit();
      break;
    case 'aiCacheRemoteHit':
      void pipelineMetrics.aiCacheRemoteHit();
      break;
    case 'aiCacheMiss':
      void pipelineMetrics.aiCacheMiss();
      break;
    case 'aiCloudRun':
      void pipelineMetrics.aiCloudRun();
      break;
  }
}

export const telemetry = {
  info: (input: TelemetryLogInput) => {
    void emit('info', input);
  },
  warn: (input: TelemetryLogInput) => {
    void emit('warn', input);
  },
  error: (input: TelemetryLogInput) => {
    void emit('error', input);
  },
  event: (name: string, input: Omit<TelemetryLogInput, 'name'> & { level?: TelemetryLevel }) => {
    const level = input.level ?? 'info';
    void emit(level, { ...input, name });
  },
  metric: (name: string, bump?: MetricBump, data?: Record<string, unknown>) => {
    if (bump) applyMetricBump(bump);
    void emit('info', { stage: 'system', name: `metric.${name}`, data, success: true });
  },
};
