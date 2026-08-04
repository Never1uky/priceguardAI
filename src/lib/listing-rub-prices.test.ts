import {
  dropLikelyPackUnitPrices,
  parseListingRubNumbers,
} from '@/lib/listing-rub-prices';
import { describe, expect, it } from 'vitest';

describe('listing rub prices', () => {
  it('skips amounts followed by «за 1 шт»', () => {
    expect(
      parseListingRubNumbers('1199 ₽ С банками 1332 ₽ 600 ₽ за 1 шт'),
    ).toEqual([1199, 1332]);
  });

  it('skips ₽/шт', () => {
    expect(parseListingRubNumbers('1332 ₽ 600 ₽/шт')).toEqual([1332]);
  });

  it('drops pack-unit min when ≈ next/2', () => {
    expect(dropLikelyPackUnitPrices([600, 1199, 1332, 3446])).toEqual([
      1199, 1332, 3446,
    ]);
  });

  it('keeps normal bank/base/old triple', () => {
    expect(dropLikelyPackUnitPrices([15_830, 15_990, 17_999])).toEqual([
      15_830, 15_990, 17_999,
    ]);
  });
});
