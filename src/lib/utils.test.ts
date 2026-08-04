import { describe, expect, it } from 'vitest';
import { paymentDiscountLabel } from '@/lib/utils';

describe('paymentDiscountLabel', () => {
  it('labels Yandex Pay and Ozon bank', () => {
    expect(paymentDiscountLabel('yandex_market')).toBe('с Пэй');
    expect(paymentDiscountLabel('ozon')).toBe('с озон банк');
  });
});
