/**
 * Интеграционный сценарий политики квоты без SW:
 * used++ только когда shouldConsume === true.
 */
import { describe, expect, it } from 'vitest';
import { shouldConsumeFullAnalysisQuota } from '@/lib/ai/full-analysis-quota-policy';

function simulateUsed(
  used: number,
  event:
    | { type: 'user_run'; ok: boolean; hasAnalysis: boolean }
    | { type: 'hydrate_cache' }
    | { type: 'soft_refresh'; ok: boolean; hasAnalysis: boolean },
): number {
  if (event.type === 'hydrate_cache') return used;

  const intent = event.type === 'soft_refresh' ? 'soft_refresh' : 'user_run';
  if (
    shouldConsumeFullAnalysisQuota({
      intent,
      ok: event.ok,
      hasAnalysis: event.hasAnalysis,
    })
  ) {
    return used + 1;
  }
  return used;
}

describe('full-analysis quota usage scenarios', () => {
  it('run + cacheHit → used++', () => {
    expect(simulateUsed(0, { type: 'user_run', ok: true, hasAnalysis: true })).toBe(1);
  });

  it('mount + cache hydrate → used same', () => {
    expect(simulateUsed(1, { type: 'hydrate_cache' })).toBe(1);
  });

  it('run + error → used same', () => {
    expect(simulateUsed(1, { type: 'user_run', ok: false, hasAnalysis: false })).toBe(1);
  });

  it('soft refresh success → used same', () => {
    expect(simulateUsed(2, { type: 'soft_refresh', ok: true, hasAnalysis: true })).toBe(2);
  });
});
