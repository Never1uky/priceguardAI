import { describe, expect, it } from 'vitest';
import {
  computeReconcileTombstones,
  isPendingTombstone,
  mergeTombstoneKeys,
} from '@/lib/tracked-reconcile';
import type { TrackedProduct } from '@/types/product';

const local: TrackedProduct[] = [
  {
    id: 'wb-111',
    marketplace: 'wildberries',
    title: 'A',
    price: 100,
    currency: '₽',
    article: '111',
    url: 'https://www.wildberries.ru/catalog/111/detail.aspx',
    scrapedAt: 1,
    trackedAt: 1,
    initialPrice: 100,
    lowestPrice: 100,
  },
  {
    id: 'ozon-222',
    marketplace: 'ozon',
    title: 'B',
    price: 200,
    currency: '₽',
    article: '222',
    url: 'https://www.ozon.ru/product/222/',
    scrapedAt: 2,
    trackedAt: 2,
    initialPrice: 200,
    lowestPrice: 200,
  },
  {
    id: 'yandex-333',
    marketplace: 'yandex_market',
    title: 'C',
    price: 300,
    currency: '₽',
    article: '333',
    url: 'https://market.yandex.ru/product/333',
    scrapedAt: 3,
    trackedAt: 3,
    initialPrice: 300,
    lowestPrice: 300,
  },
  {
    id: 'wb-444',
    marketplace: 'wildberries',
    title: 'D',
    price: 400,
    currency: '₽',
    article: '444',
    url: 'https://www.wildberries.ru/catalog/444/detail.aspx',
    scrapedAt: 4,
    trackedAt: 4,
    initialPrice: 400,
    lowestPrice: 400,
  },
];

describe('computeReconcileTombstones', () => {
  it('local 4, server 10 → 6 tombstones', () => {
    const remote = [
      ...local.map((p) => ({
        marketplace: p.marketplace,
        product_id: p.article!,
        deleted: false,
      })),
      { marketplace: 'ozon' as const, product_id: '999001', deleted: false },
      { marketplace: 'ozon' as const, product_id: '999002', deleted: false },
      { marketplace: 'wildberries' as const, product_id: '999003', deleted: false },
      { marketplace: 'wildberries' as const, product_id: '999004', deleted: false },
      { marketplace: 'yandex_market' as const, product_id: '999005', deleted: false },
      { marketplace: 'yandex_market' as const, product_id: '999006', deleted: false },
    ];

    const tombstones = computeReconcileTombstones(local, remote);
    expect(tombstones).toHaveLength(6);
    expect(tombstones.map((t) => t.productId).sort()).toEqual([
      '999001',
      '999002',
      '999003',
      '999004',
      '999005',
      '999006',
    ]);
  });

  it('ignores already deleted server rows', () => {
    const tombstones = computeReconcileTombstones(local, [
      { marketplace: 'ozon', product_id: '999', deleted: true },
    ]);
    expect(tombstones).toHaveLength(0);
  });
});

describe('mergeTombstoneKeys', () => {
  it('dedupes by marketplace:productId', () => {
    const merged = mergeTombstoneKeys(
      [{ marketplace: 'ozon', productId: '1' }],
      [{ marketplace: 'ozon', productId: '1' }, { marketplace: 'ozon', productId: '2' }],
    );
    expect(merged).toHaveLength(2);
  });
});

describe('isPendingTombstone', () => {
  it('matches pending keys', () => {
    expect(
      isPendingTombstone(
        { marketplace: 'ozon', product_id: '55' },
        [{ marketplace: 'ozon', productId: '55' }],
      ),
    ).toBe(true);
  });
});
