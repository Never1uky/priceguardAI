import { describe, expect, it } from 'vitest';
import {
  demoteMappingOnDispute,
  hasBlockingRejectFeedback,
  shouldSkipAutoUpsert,
} from '@/lib/mapping-demotion-policy';
import { shouldPromoteMultiUserMapping, aggregateMatchFeedback } from '@/lib/multi-user-mapping-policy';
import {
  scoreProductMatch,
  shouldWarnWeakMatch,
  getMatchWarnKind,
} from '@/lib/product-match';
import { inferProductCategory, areCategoriesIncompatible } from '@/lib/match-category';
import {
  areLineageGenerationsCompatible,
  extractLineageGeneration,
} from '@/lib/lineage-generation';

describe('1a mapping demotion policy', () => {
  it('demotes confidence and hits on dispute', () => {
    expect(demoteMappingOnDispute({ confidence: 88, hits: 5 })).toEqual({
      confidence: 53,
      hits: 3,
    });
    expect(demoteMappingOnDispute({ confidence: 10, hits: 1 })).toEqual({
      confidence: 0,
      hits: 0,
    });
  });

  it('skips auto upsert for disputed/dead', () => {
    expect(shouldSkipAutoUpsert('disputed')).toBe(true);
    expect(shouldSkipAutoUpsert('dead')).toBe(true);
    expect(shouldSkipAutoUpsert('active')).toBe(false);
  });

  it('blocks on reject feedback or disputed flag', () => {
    expect(hasBlockingRejectFeedback(1)).toBe(true);
    expect(hasBlockingRejectFeedback(0, { disputedOrDead: true })).toBe(true);
    expect(hasBlockingRejectFeedback(0)).toBe(false);
  });

  it('blocks multi_user promote when rejects >= half accepts', () => {
    const stats = aggregateMatchFeedback([
      { accepted: true, created_at: '2026-07-01T10:00:00Z' },
      { accepted: true, created_at: '2026-07-02T10:00:00Z' },
      { accepted: false, created_at: '2026-07-03T10:00:00Z' },
    ]);
    expect(stats.accepts).toBe(2);
    expect(stats.rejects).toBe(1);
    expect(shouldPromoteMultiUserMapping(stats).ok).toBe(false);
  });
});

describe('1b networking vs power tools / generic', () => {
  it('Cudy AP → networking, jigsaw → power_tools, incompatible score 0', () => {
    const ap = 'Cudy Точка доступа AP3000 Outdoor AX3000';
    const saw = 'Лобзик электрический ИНТЕРСКОЛ МП-65';
    expect(inferProductCategory(ap)).toBe('networking');
    expect(inferProductCategory(saw)).toBe('power_tools');
    expect(areCategoriesIncompatible('networking', 'power_tools')).toBe(true);
    expect(scoreProductMatch(ap, saw)).toBe(0);
    expect(shouldWarnWeakMatch(ap, saw, 80)).toBe(true);
    expect(getMatchWarnKind(ap, saw, 80)).toBe('category');
  });

  it('generic vs specific score is capped', () => {
    const generic = 'Товар без явной категории XYZ-999';
    const tool = 'Лобзик электрический ИНТЕРСКОЛ МП-65';
    const score = scoreProductMatch(generic, tool);
    expect(score).toBeLessThanOrEqual(0.35);
  });
});

describe('match warn: not for near-identical TVs', () => {
  it('same TV titles + conf 55–64 → no category warn', () => {
    const a = 'Haier Телевизор 65H5GUX 65" (2026) 4K';
    const b = 'Haier Телевизор 65 LED H5, DBX-TV, 4K UHD';
    expect(inferProductCategory(a)).toBe('tvs');
    expect(inferProductCategory(b)).toBe('tvs');
    expect(getMatchWarnKind(a, b, 58)).toBeNull();
    expect(shouldWarnWeakMatch(a, b, 58)).toBe(false);
  });

  it('DualSense vs PS5 Slim → category warn', () => {
    const pad = 'Беспроводной контроллер DualSense для PlayStation 5';
    const consoleTitle = 'Игровая приставка PlayStation 5 Slim 1000 ГБ';
    expect(inferProductCategory(pad)).toBe('accessories');
    expect(inferProductCategory(consoleTitle)).toBe('consoles');
    expect(getMatchWarnKind(pad, consoleTitle, 80)).toBe('category');
  });
});

describe('2 lineage generation digits', () => {
  it('extracts buds generation', () => {
    expect(extractLineageGeneration('Redmi Беспроводные наушники Buds 5 Titan')).toEqual({
      lineage: 'buds:redmi',
      gen: 5,
    });
    expect(extractLineageGeneration('Xiaomi Redmi Buds 6 Play')).toEqual({
      lineage: 'buds:redmi',
      gen: 6,
    });
  });

  it('Buds 5 Titan vs Buds 6 Play → low score', () => {
    const a = 'Redmi Беспроводные наушники Buds 5 Titan';
    const b = 'Xiaomi Redmi Buds 6 Play чёрные';
    expect(areLineageGenerationsCompatible(a, b)).toBe(false);
    expect(scoreProductMatch(a, b)).toBeLessThanOrEqual(0.15);
  });

  it('same Buds 5 stays high', () => {
    const a = 'Redmi Беспроводные наушники Buds 5 Titan';
    const b = 'Наушники Xiaomi Redmi Buds 5 Titan белые';
    expect(areLineageGenerationsCompatible(a, b)).toBe(true);
    expect(scoreProductMatch(a, b)).toBeGreaterThan(0.5);
  });

  it('iPhone 13 vs iPhone 14 still mismatch', () => {
    const a = 'Смартфон Apple iPhone 13 128GB';
    const b = 'Смартфон Apple iPhone 14 128GB';
    expect(areLineageGenerationsCompatible(a, b)).toBe(false);
    expect(scoreProductMatch(a, b)).toBeLessThanOrEqual(0.15);
  });
});
