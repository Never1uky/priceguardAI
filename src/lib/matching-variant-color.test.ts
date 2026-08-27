import { describe, expect, it } from 'vitest';
import { extractNormalizedColor, normalizeColor } from '@/lib/attr-normalize';
import { extractProductFeatures } from '@/lib/product-features';
import { pickTopMatchesWithScore, scoreProductMatch } from '@/lib/product-match';
import { inferProductCategory } from '@/lib/match-category';

const REF = 'Смартфон Google Pixel 10 128GB Obsidian';
const EXACT = 'Смартфон Google Pixel 10 128GB Obsidian';
const PORCELAIN = 'Смартфон Google Pixel 10 128GB Porcelain';
const STORAGE_256 = 'Смартфон Google Pixel 10 256GB Obsidian';
const PIXEL_9 = 'Смартфон Google Pixel 9 128GB Obsidian';
const PIXEL_PRO = 'Смартфон Google Pixel 10 Pro 128GB Obsidian';
const CASE = 'Чехол для Google Pixel 10 силиконовый';
const NO_COLOR = 'Смартфон Google Pixel 10 128GB';

describe('matching variant color (Pixel marketing names)', () => {
  it('extracts Obsidian / Porcelain / Indigo into color families', () => {
    expect(normalizeColor('Obsidian')).toBe('black');
    expect(normalizeColor('Porcelain')).toBe('white');
    expect(normalizeColor('Indigo')).toBe('purple');
    expect(extractNormalizedColor(REF)).toBe('black');
    expect(extractNormalizedColor(PORCELAIN)).toBe('white');
    expect(extractProductFeatures(REF).color).toBe('black');
    expect(extractProductFeatures(PORCELAIN).color).toBe('white');
    expect(extractProductFeatures(REF).storage).toBe('128gb');
    expect(inferProductCategory(REF)).toBe('smartphones');
  });

  it('1 exact color same identity → highest', () => {
    const exact = scoreProductMatch(REF, EXACT);
    expect(exact).toBeGreaterThan(0.7);
    expect(exact).toBeGreaterThan(scoreProductMatch(REF, PORCELAIN));
  });

  it('2 same identity different color → valid but below exact', () => {
    const porcelain = scoreProductMatch(REF, PORCELAIN);
    expect(porcelain).toBeGreaterThan(0);
    expect(porcelain).toBeLessThan(scoreProductMatch(REF, EXACT));
  });

  it('3 different storage → score 0', () => {
    expect(scoreProductMatch(REF, STORAGE_256)).toBe(0);
  });

  it('4 different generation → score 0', () => {
    expect(scoreProductMatch(REF, PIXEL_9)).toBe(0);
  });

  it('5 Pixel 10 vs Pixel 10 Pro → reject', () => {
    expect(scoreProductMatch(REF, PIXEL_PRO)).toBe(0);
  });

  it('6 accessory case → score 0', () => {
    expect(scoreProductMatch(REF, CASE)).toBe(0);
  });

  it('7 Megamarket-style titles: Obsidian ranks above Porcelain', () => {
    const megaRef = 'Google Смартфон Google Pixel 10 128GB Obsidian';
    const megaPorcelain = 'Смартфон Google Pixel 10 128GB Porcelain';
    expect(extractProductFeatures(megaRef).color).toBe('black');
    expect(extractProductFeatures(megaPorcelain).color).toBe('white');
    expect(scoreProductMatch(megaRef, megaRef)).toBeGreaterThan(
      scoreProductMatch(megaRef, megaPorcelain),
    );
  });

  it('10 missing candidate color remains valid when identity matches', () => {
    const score = scoreProductMatch(REF, NO_COLOR);
    expect(score).toBeGreaterThan(0);
  });

  it('11 pickTopMatchesWithScore ranks exact then other color; rejects junk', () => {
    const pool = [
      { title: PORCELAIN, id: 'porcelain' },
      { title: STORAGE_256, id: '256' },
      { title: EXACT, id: 'exact' },
      { title: PIXEL_9, id: 'pixel9' },
      { title: CASE, id: 'case' },
    ];
    const top = pickTopMatchesWithScore(REF, pool, (c) => c.title, {
      minScore: 0.38,
      limit: 10,
    });
    expect(top.map((t) => t.item.id)).toEqual(['exact', 'porcelain']);
    expect(top[0]!.score).toBeGreaterThan(top[1]!.score);
    expect(top.every((t) => t.score > 0)).toBe(true);
  });
});
