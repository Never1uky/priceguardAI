import { describe, expect, it } from 'vitest';
import { buildOutOfStockProduct, isProductOutOfStock } from '@/lib/product-availability';

describe('product-availability', () => {
  it('buildOutOfStockProduct sets price 0 and availability', () => {
    const p = buildOutOfStockProduct({
      marketplace: 'wildberries',
      title: 'iPhone 15 128GB',
      article: '205062866',
      url: 'https://www.wildberries.ru/catalog/205062866/detail.aspx',
    });
    expect(p.price).toBe(0);
    expect(p.availability).toBe('out_of_stock');
    expect(isProductOutOfStock(p)).toBe(true);
  });

  it('in_stock product with price is not OOS', () => {
    expect(
      isProductOutOfStock({ price: 1000, availability: 'in_stock' }),
    ).toBe(false);
  });
});
