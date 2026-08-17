import { describe, expect, it } from 'vitest';
import {
  computeCandidatePriority,
  decideMatchOutcome,
  resolveMatchStatus,
  matchStatusShortHint,
} from '@/lib/match-status';

describe('match-status', () => {
  it('maps source to verified', () => {
    expect(resolveMatchStatus({ isSource: true, found: true })).toBe('verified');
  });

  it('needs_choice when manual pick required', () => {
    expect(resolveMatchStatus({ needsManualPick: true, alternativeCount: 2 })).toBe('needs_choice');
  });

  it('probable when auto-picked with alternatives', () => {
    expect(
      resolveMatchStatus({ found: true, matchConfidence: 88, alternativeCount: 2 }),
    ).toBe('probable');
  });

  it('verified when high confidence and no alternatives', () => {
    expect(
      resolveMatchStatus({ found: true, matchConfidence: 95, alternativeCount: 0 }),
    ).toBe('verified');
  });

  it('decideMatchOutcome forces choice on close tie', () => {
    const d = decideMatchOutcome({ bestMatch: 96, secondMatch: 95, alternativeCount: 2 });
    expect(d.needsChoice).toBe(true);
    expect(d.status).toBe('needs_choice');
  });

  it('priority boosts cheaper high-rated offers', () => {
    const a = computeCandidatePriority({
      match: 90,
      price: 50_000,
      referencePrice: 60_000,
      rating: 4.8,
      hasProductUrl: true,
    });
    const b = computeCandidatePriority({
      match: 90,
      price: 70_000,
      referencePrice: 60_000,
      rating: 3.5,
      hasProductUrl: true,
    });
    expect(a).toBeGreaterThan(b);
  });

  it('cheap SERP price beats dear high-rated official (Pixel 7 case)', () => {
    const ref = 23_098;
    const cheap = computeCandidatePriority({
      match: 90,
      price: 24_682,
      referencePrice: ref,
      rating: null,
      hasProductUrl: true,
    });
    const dear = computeCandidatePriority({
      match: 90,
      price: 34_549,
      referencePrice: ref,
      rating: 5.0,
      hasProductUrl: true,
    });
    expect(cheap).toBeGreaterThan(dear);
  });

  it('hints never include percents', () => {
    expect(matchStatusShortHint('probable', 2)).not.toMatch(/%/);
    expect(matchStatusShortHint('needs_choice', 3)).toMatch(/похожих/);
  });
});
