import { describe, expect, it } from 'vitest';
import {
  AUTO_PICK_CONFIDENCE_THRESHOLD,
  MIN_COMPARE_MATCH_CONFIDENCE,
  computeMatchConfidence,
  scoreProductMatch,
} from '@/lib/product-match';
import { decideMatchOutcome } from '@/lib/match-status';

describe('P0 matching-report golden pairs', () => {
  it('iPhone 17 256GB vs 512GB is hard mismatch and never auto-pick', () => {
    const ref = 'Смартфон Apple iPhone 17 256GB';
    const cand = 'Смартфон Apple iPhone 17 512GB';
    const score = scoreProductMatch(ref, cand);
    const confidence = computeMatchConfidence(ref, cand);
    expect(score).toBe(0);
    expect(confidence).toBeLessThan(MIN_COMPARE_MATCH_CONFIDENCE);
    const outcome = decideMatchOutcome({ bestMatch: confidence, alternativeCount: 0 });
    expect(outcome.autoPick).toBe(false);
    expect(outcome.status).toBe('not_found');
  });

  it('AirPods Pro 2 USB-C vs Lightning is hard mismatch', () => {
    const ref = 'Apple AirPods Pro 2 USB-C';
    const cand = 'Apple AirPods Pro 2 Lightning';
    expect(scoreProductMatch(ref, cand, undefined, 'headphones')).toBe(0);
  });

  it('AirPods Pro 2 USB-C vs AirPods Pro 2 (unknown connector) is not auto-pick', () => {
    const ref = 'Apple AirPods Pro 2 USB-C';
    const cand = 'Apple AirPods Pro 2';
    const confidence = computeMatchConfidence(ref, cand);
    expect(confidence).toBeGreaterThanOrEqual(MIN_COMPARE_MATCH_CONFIDENCE);
    expect(confidence).toBeLessThan(AUTO_PICK_CONFIDENCE_THRESHOLD);
    const outcome = decideMatchOutcome({ bestMatch: confidence, alternativeCount: 1 });
    expect(outcome.autoPick).toBe(false);
    expect(outcome.needsChoice).toBe(true);
  });

  it('Dyson Supersonic HD08 vs "фен для Dyson" is hard mismatch', () => {
    const ref = 'Фен Dyson Supersonic HD08';
    const cand = 'Фен для Dyson Supersonic HD08';
    expect(scoreProductMatch(ref, cand)).toBe(0);
  });
});
