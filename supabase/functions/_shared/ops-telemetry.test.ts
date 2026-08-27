import { describe, expect, it } from 'vitest';
import {
  isOpsEventName,
  monitorScrapeOpsEvents,
  sanitizeOpsPayload,
} from './ops-telemetry.ts';

describe('ops-telemetry', () => {
  it('recognizes Phase 11 event names', () => {
    expect(isOpsEventName('telegram_monitor_check')).toBe(true);
    expect(isOpsEventName('COMPARE_MP_ATTEMPT')).toBe(false);
  });

  it('strips PII keys from payload', () => {
    const out = sanitizeOpsPayload({
      source: 'cache',
      product_id: '123',
      url: 'https://example.com',
      title: 'secret',
      subscriber_count: 3,
    });
    expect(out).toEqual({ source: 'cache', subscriber_count: 3 });
  });

  it('monitorScrapeOpsEvents emits check + cache hit', () => {
    const events = monitorScrapeOpsEvents({
      marketplace: 'ozon',
      source: 'cache',
      subscriber_count: 4,
      stale_count: 2,
    });
    expect(events.map((e) => e.name)).toEqual([
      'telegram_monitor_check',
      'telegram_monitor_cache_hit',
    ]);
  });

  it('monitorScrapeOpsEvents skips scrape when all fresh', () => {
    const events = monitorScrapeOpsEvents({
      marketplace: 'wildberries',
      source: null,
      subscriber_count: 2,
      stale_count: 0,
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.name).toBe('telegram_monitor_check');
  });
});
