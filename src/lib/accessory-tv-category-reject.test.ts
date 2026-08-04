import { describe, expect, it } from 'vitest';
import { inferProductCategory } from '@/lib/match-category';
import { DEFAULT_MIN_MATCH_SCORE, scoreProductMatch } from '@/lib/product-match';

describe('accessories / tvs category reject', () => {
  it('infers accessories for case / film / cable without primary device word', () => {
    expect(inferProductCategory('Чехол для iPhone 17 Pro')).toBe('accessories');
    expect(inferProductCategory('Защитное стекло iPhone 15')).toBe('accessories');
    expect(inferProductCategory('Плёнка для Samsung Galaxy S24')).toBe('accessories');
    expect(inferProductCategory('Сумка для ноутбука 15.6')).toBe('accessories');
  });

  it('infers smartphones when title has смартфон / iPhone as product', () => {
    expect(inferProductCategory('Смартфон iPhone 17 Pro 256GB')).toBe('smartphones');
    expect(inferProductCategory('Apple iPhone 17 Pro Max')).toBe('smartphones');
  });

  it('infers tvs and monitors', () => {
    expect(inferProductCategory('Телевизор Samsung UE55CU7100UXRU')).toBe('tvs');
    expect(inferProductCategory('Samsung Smart TV UE55')).toBe('tvs');
    expect(inferProductCategory('Монитор Samsung Odyssey G5 27')).toBe('monitors');
  });

  it('rejects case vs phone', () => {
    expect(scoreProductMatch('Смартфон iPhone 17 Pro', 'Чехол для iPhone 17 Pro')).toBe(0);
    expect(scoreProductMatch('iPhone 17 Pro 256GB', 'Чехол для iPhone 17 Pro')).toBe(0);
  });

  it('still matches phone vs phone', () => {
    const a = 'Смартфон Apple iPhone 17 Pro 256GB';
    const b = 'Apple iPhone 17 Pro 256 ГБ';
    expect(inferProductCategory(a)).toBe('smartphones');
    expect(scoreProductMatch(a, b)).toBeGreaterThanOrEqual(DEFAULT_MIN_MATCH_SCORE);
  });

  it('rejects TV vs accessory / non-TV', () => {
    expect(scoreProductMatch('Телевизор Samsung UE55CU7100', 'Чехол для пульта TV')).toBe(0);
    expect(scoreProductMatch('Телевизор Samsung UE55CU7100', 'Монитор Samsung Odyssey 27')).toBe(0);
  });

  it('still matches TV vs TV', () => {
    const a = 'Телевизор Samsung UE55CU7100UXRU';
    const b = 'Телевизор Samsung UE55CU7100UXRU 55" Smart TV';
    expect(inferProductCategory(a)).toBe('tvs');
    expect(inferProductCategory(b)).toBe('tvs');
    expect(scoreProductMatch(a, b)).toBeGreaterThanOrEqual(DEFAULT_MIN_MATCH_SCORE);
  });
});
