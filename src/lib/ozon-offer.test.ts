import { describe, expect, it } from 'vitest';
import { parseOzonWidgetStates } from '@/lib/ozon-offer';

const productUrl =
  'https://www.ozon.ru/product/xiaomi-redmi-buds-8-active-besprovodnye-vkladyshi-naushniki-belye-3627230317/';

describe('parseOzonWidgetStates product page', () => {
  it('parses classic title+price widget', () => {
    const offer = parseOzonWidgetStates(
      {
        webProductHeading: JSON.stringify({
          title: 'Xiaomi Redmi Buds 8 Active белые',
          price: '2 499 ₽',
          originalPrice: '3 999 ₽',
          totalScore: 4.7,
          reviewsCount: 120,
        }),
      },
      productUrl,
    );

    expect(offer).not.toBeNull();
    expect(offer!.price).toBe(2499);
    expect(offer!.title).toContain('Redmi Buds');
    expect(offer!.url).toBe(productUrl);
  });

  it('parses nested webPrice priceV2 without top-level title', () => {
    const offer = parseOzonWidgetStates(
      {
        'webPrice-312345': JSON.stringify({
          priceV2: {
            price: [{ text: '2 199 ₽' }, { text: '2 499 ₽' }],
          },
          atom: { text: 'Xiaomi Redmi Buds 8 Active' },
        }),
      },
      productUrl,
    );

    expect(offer).not.toBeNull();
    expect(offer!.price).toBeGreaterThan(0);
    expect(offer!.title).toContain('Redmi Buds');
  });

  it('deep-scans nested cardPrice fields', () => {
    const offer = parseOzonWidgetStates(
      {
        pdpMain: JSON.stringify({
          nested: {
            webSale: {
              title: 'Наушники Xiaomi',
              cardPrice: '1899',
            },
          },
        }),
      },
      productUrl,
    );

    expect(offer).not.toBeNull();
    expect(offer!.price).toBe(1899);
  });
});
