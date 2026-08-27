import { describe, expect, it } from 'vitest';
import { resolveMonitoringKey } from './monitoring-key.ts';
import {
  activeSubscriberCount,
  coalesceTrackedSkuGroups,
} from './update-prices-coalesce.ts';

describe('resolveMonitoringKey', () => {
  it('prefers marketplace + product_id (bare)', () => {
    const k = resolveMonitoringKey({
      marketplace: 'ozon',
      productId: '12345',
      productUrl: 'https://www.ozon.ru/product/other-name-99999/',
      title: 'Should Never Matter',
    });
    expect(k).toEqual({
      key: 'ozon:12345',
      marketplace: 'ozon',
      productId: '12345',
      source: 'product_id',
    });
  });

  it('strips prefixes before keying', () => {
    expect(
      resolveMonitoringKey({ marketplace: 'ozon', productId: 'ozon-12345' })?.key,
    ).toBe('ozon:12345');
    expect(
      resolveMonitoringKey({ marketplace: 'wildberries', productId: 'wb-5555' })?.key,
    ).toBe('wildberries:5555');
  });

  it('falls back to URL when product_id missing/unstable', () => {
    const k = resolveMonitoringKey({
      marketplace: 'ozon',
      productId: '',
      productUrl:
        'https://www.ozon.ru/product/some-slug-tr-98101-2l-1435731950/?sh=abc',
      title: 'Стиральная машина',
    });
    expect(k?.source).toBe('canonical_url');
    expect(k?.key).toBe('ozon:1435731950');
  });

  it('never uses title alone', () => {
    expect(
      resolveMonitoringKey({
        marketplace: 'ozon',
        productId: '',
        productUrl: null,
        title: 'iPhone 15 Pro 256',
      }),
    ).toBeNull();
  });
});

describe('coalesceTrackedSkuGroups — Phase 5 scenarios', () => {
  it('different URLs of same Ozon SKU → one target', () => {
    const groups = coalesceTrackedSkuGroups([
      {
        priority: false,
        row: {
          marketplace: 'ozon',
          product_id: '1435731950',
          product_url: 'https://www.ozon.ru/product/foo-1435731950/?from=share',
        },
      },
      {
        priority: false,
        row: {
          marketplace: 'ozon',
          product_id: '1435731950',
          product_url: 'https://ozon.ru/product/bar-1435731950/',
        },
      },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.key).toBe('ozon:1435731950');
    expect(groups[0]!.rows).toHaveLength(2);
  });

  it('extension bare id + Telegram URL-only row coalesce', () => {
    const groups = coalesceTrackedSkuGroups([
      {
        priority: false,
        row: {
          marketplace: 'ozon',
          product_id: '1435731950',
          product_url: null,
          product_title: 'Extension track',
        },
      },
      {
        priority: false,
        row: {
          marketplace: 'ozon',
          product_id: '',
          product_url: 'https://www.ozon.ru/product/name-1435731950/',
          product_title: 'Telegram track',
        },
      },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.rows).toHaveLength(2);
  });

  it('re-add same user same SKU stays one subscriber slot in group', () => {
    // Coalesce is per work-queue rows; unique constraint is DB-level.
    // Two identical keys from same logical add would still be one scrape.
    const groups = coalesceTrackedSkuGroups([
      {
        priority: false,
        row: { marketplace: 'ozon', product_id: '12345', product_url: null, user: 'A' },
      },
      {
        priority: false,
        row: { marketplace: 'ozon', product_id: '12345', product_url: null, user: 'A' },
      },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.productId).toBe('12345');
  });

  it('multiple users → one scrape group', () => {
    const groups = coalesceTrackedSkuGroups([
      {
        priority: false,
        row: { marketplace: 'ozon', product_id: '12345', product_url: null, user: 'A' },
      },
      {
        priority: true,
        row: { marketplace: 'ozon', product_id: '12345', product_url: null, user: 'B' },
      },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.rows).toHaveLength(2);
    expect(groups[0]!.priority).toBe(true);
  });

  it('removing one user leaves scrape for remaining subscribers', () => {
    const remaining = coalesceTrackedSkuGroups([
      {
        priority: false,
        row: { marketplace: 'ozon', product_id: '12345', product_url: null, user: 'B' },
      },
    ]);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.rows).toHaveLength(1);
  });

  it('last subscriber gone → no monitoring group (no scrape)', () => {
    const groups = coalesceTrackedSkuGroups([]);
    expect(groups).toHaveLength(0);
    expect(activeSubscriberCount([{ deleted: true }, { deleted: true }])).toBe(0);
    expect(activeSubscriberCount([{ deleted: false }, { deleted: true }])).toBe(1);
  });

  it('same title different SKUs stay separate', () => {
    const groups = coalesceTrackedSkuGroups([
      {
        priority: false,
        row: {
          marketplace: 'ozon',
          product_id: '11111',
          product_url: null,
          product_title: 'Same Title Phone',
        },
      },
      {
        priority: false,
        row: {
          marketplace: 'ozon',
          product_id: '22222',
          product_url: null,
          product_title: 'Same Title Phone',
        },
      },
    ]);
    expect(groups).toHaveLength(2);
  });
});
