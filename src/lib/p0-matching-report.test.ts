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

  it('refurbished iPhone 17 vs new iPhone 17 is hard mismatch', () => {
    const ref = 'Смартфон Apple iPhone 17 refurbished';
    const cand = 'Смартфон Apple iPhone 17 new';
    expect(scoreProductMatch(ref, cand, undefined, 'smartphones')).toBe(0);
  });

  it('original/oem vs replica/analog is hard mismatch for same model', () => {
    const ref = 'Аккумулятор Dyson V11 OEM original';
    const cand = 'Аккумулятор Dyson V11 реплика аналог';
    expect(scoreProductMatch(ref, cand, undefined, 'accessories')).toBe(0);
  });

  it('global vs ru and esim-only vs physical sim are hard mismatches when explicit', () => {
    expect(
      scoreProductMatch('Apple iPhone 17 Global Version', 'Apple iPhone 17 RU Ростест', undefined, 'smartphones'),
    ).toBe(0);
    expect(
      scoreProductMatch('Apple iPhone 17 eSIM only', 'Apple iPhone 17 physical SIM', undefined, 'smartphones'),
    ).toBe(0);
  });

  it('disc vs digital console edition is hard mismatch', () => {
    const ref = 'Sony PlayStation 5 Disc Edition';
    const cand = 'Sony PlayStation 5 Digital Edition';
    expect(scoreProductMatch(ref, cand, undefined, 'consoles')).toBe(0);
  });

  it('2 шт vs 1 шт is hard mismatch for detergents when both counts are explicit', () => {
    const ref = 'Persil Color гель 1.3 л 2 шт';
    const cand = 'Persil Color гель 1.3 л 1 шт';
    expect(scoreProductMatch(ref, cand, undefined, 'detergents')).toBe(0);
  });

  it('keeps existing guardrails: DualSense vs PS5 and Pixel generation mismatch', () => {
    expect(scoreProductMatch('Геймпад Sony DualSense', 'Sony PlayStation 5', undefined, 'accessories')).toBe(0);
    expect(scoreProductMatch('Google Pixel 8', 'Google Pixel 7', undefined, 'smartphones')).toBe(0);
  });

  it('keeps memory-cards lineage and apparel size-soft behavior', () => {
    expect(
      scoreProductMatch(
        'Карта памяти Kingston Canvas Go Plus Gen4 128GB',
        'Карта памяти Kingston Canvas Select Plus Gen4 128GB',
        undefined,
        'memory_cards',
      ),
    ).toBe(0);
    expect(
      computeMatchConfidence(
        'Футболка Nike Dri-FIT мужская чёрная размер M',
        'Футболка Nike Dri-FIT мужская черная размер L',
      ),
    ).toBeGreaterThanOrEqual(AUTO_PICK_CONFIDENCE_THRESHOLD);
  });

  it('Head & Shoulders Menthol vs Citrus is hard mismatch (QA P1-1)', () => {
    const ref = 'Head & Shoulders шампунь от перхоти Ментол 0,6 л';
    const cand = 'Head & Shoulders шампунь Цитрусовая свежесть для жирных волос 600 мл';
    expect(scoreProductMatch(ref, cand, undefined, 'cosmetics')).toBe(0);
    expect(computeMatchConfidence(ref, cand)).toBeLessThan(MIN_COMPARE_MATCH_CONFIDENCE);
  });

  it('Sony WH-1000XM5 vs XM6 is hard mismatch (QA P1-2)', () => {
    const ref = 'Sony WH-1000XM5 беспроводные наушники';
    const cand = 'Sony WH-1000XM6 беспроводные наушники';
    expect(scoreProductMatch(ref, cand, undefined, 'headphones')).toBe(0);
    expect(computeMatchConfidence(ref, cand)).toBeLessThan(MIN_COMPARE_MATCH_CONFIDENCE);
  });
});
