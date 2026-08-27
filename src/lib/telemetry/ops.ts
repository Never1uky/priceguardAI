/**
 * Phase 11 operational metrics — privacy-safe (no URL/title/chat/product id).
 * Always stored locally; remote when telemetry opt-in (same as funnel).
 */
import { telemetry } from '@/lib/telemetry/log';

export const OPS_EVENT_NAMES = [
  'marketplace_search_started',
  'marketplace_search_success',
  'marketplace_search_failed',
  'scrape_request',
  'scrape_cache_hit',
  'scrape_cache_miss',
  'telegram_monitor_check',
  'telegram_monitor_cache_hit',
  'telegram_monitor_scrape',
  'telegram_alert_sent',
  'telegram_monitor_error',
] as const;

export type OpsEventName = (typeof OPS_EVENT_NAMES)[number];

export type OpsScrapeSource = 'cache' | 'scrappey' | 'legacy' | 'api' | 'tab';
export type OpsContext = 'compare' | 'monitor' | 'unlocker' | 'card';
export type OpsAlertType =
  | 'price_drop'
  | 'target_price'
  | 'compare_price_drop'
  | 'cheaper_elsewhere'
  | 'generic';

export interface OpsMetricInput {
  name: OpsEventName;
  marketplace?: string;
  success?: boolean;
  elapsedMs?: number;
  errorCode?: string;
  stage?: 'search' | 'cache' | 'card' | 'telegram' | 'system';
  source?: OpsScrapeSource;
  path?: string;
  context?: OpsContext;
  reason?: string;
  alertType?: OpsAlertType;
  subscriberCount?: number;
  staleCount?: number;
  scrappey?: boolean;
}

function buildOpsData(input: OpsMetricInput): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  if (input.source) data.source = input.source;
  if (input.path) data.path = input.path.slice(0, 32);
  if (input.context) data.context = input.context;
  if (input.reason) data.reason = input.reason.slice(0, 64);
  if (input.alertType) data.alert_type = input.alertType;
  if (input.subscriberCount != null) data.subscriber_count = input.subscriberCount;
  if (input.staleCount != null) data.stale_count = input.staleCount;
  if (input.scrappey != null) data.scrappey = input.scrappey;
  return data;
}

export function trackOpsMetric(input: OpsMetricInput): void {
  telemetry.info({
    stage: input.stage ?? 'system',
    name: input.name,
    marketplace: input.marketplace,
    success: input.success,
    elapsedMs: input.elapsedMs,
    errorCode: input.errorCode,
    data: buildOpsData(input),
    ops: true,
  });
}

export function trackMarketplaceSearchStarted(marketplace: string): void {
  trackOpsMetric({
    name: 'marketplace_search_started',
    marketplace,
    stage: 'search',
    context: 'compare',
  });
}

export function trackMarketplaceSearchFinished(input: {
  marketplace: string;
  success: boolean;
  elapsedMs?: number;
  reason?: string;
}): void {
  trackOpsMetric({
    name: input.success ? 'marketplace_search_success' : 'marketplace_search_failed',
    marketplace: input.marketplace,
    success: input.success,
    elapsedMs: input.elapsedMs,
    errorCode: input.success ? undefined : input.reason ?? 'search_failed',
    stage: 'search',
    context: 'compare',
    reason: input.reason,
  });
}

export function trackScrapeCacheHit(input: {
  marketplace: string;
  context: OpsContext;
  source?: OpsScrapeSource;
}): void {
  trackOpsMetric({
    name: 'scrape_cache_hit',
    marketplace: input.marketplace,
    success: true,
    stage: 'cache',
    context: input.context,
    source: input.source ?? 'cache',
  });
}

export function trackScrapeCacheMiss(input: {
  marketplace: string;
  context: OpsContext;
}): void {
  trackOpsMetric({
    name: 'scrape_cache_miss',
    marketplace: input.marketplace,
    success: true,
    stage: 'cache',
    context: input.context,
  });
}

export function trackScrapeRequest(input: {
  marketplace: string;
  context: OpsContext;
  source: OpsScrapeSource;
  success?: boolean;
  elapsedMs?: number;
  reason?: string;
}): void {
  trackOpsMetric({
    name: 'scrape_request',
    marketplace: input.marketplace,
    success: input.success ?? true,
    elapsedMs: input.elapsedMs,
    errorCode: input.success === false ? input.reason ?? 'scrape_failed' : undefined,
    stage: 'card',
    context: input.context,
    source: input.source,
    reason: input.reason,
  });
}

export function trackTelegramAlertSent(input: {
  marketplace?: string;
  alertType: OpsAlertType;
  context?: 'client' | 'server';
}): void {
  trackOpsMetric({
    name: 'telegram_alert_sent',
    marketplace: input.marketplace,
    success: true,
    stage: 'telegram',
    alertType: input.alertType,
    context: input.context === 'server' ? 'monitor' : 'compare',
  });
}
