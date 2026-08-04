import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  buildPickHistoryBoostMap,
  getPickHistoryBoost,
  pickHistoryBoostToScoreDelta,
  rememberPickHistory,
} from '@/lib/pick-history';
import { pickTopMatchesWithScore } from '@/lib/product-match';

const store: Record<string, unknown> = {};

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: store[key] })),
        set: vi.fn(async (payload: Record<string, unknown>) => {
          Object.assign(store, payload);
        }),
      },
    },
  });
});

describe('pick-history learning boost', () => {
  it('pickHistoryBoostToScoreDelta maps 5 → 0.05', () => {
    expect(pickHistoryBoostToScoreDelta(5)).toBe(0.05);
    expect(pickHistoryBoostToScoreDelta(0)).toBe(0);
  });

  it('getPickHistoryBoost returns higher boost for exact URL match', async () => {
    await rememberPickHistory({
      referenceTitle: 'Смартфон Xiaomi Redmi 15C 8/256',
      marketplace: 'ozon',
      url: 'https://www.ozon.ru/product/redmi-15c-123/',
      title: 'Redmi 15C 8/256',
    });

    const boost = await getPickHistoryBoost(
      'Смартфон Xiaomi Redmi 15C 8/256',
      'ozon',
      'https://www.ozon.ru/product/redmi-15c-123/',
      'Redmi 15C',
    );
    expect(boost).toBeGreaterThanOrEqual(2);
  });

  it('buildPickHistoryBoostMap elevates previously picked candidate in ranking', async () => {
    const pickedUrl = 'https://www.ozon.ru/product/picked-111/';
    const otherUrl = 'https://www.ozon.ru/product/other-222/';

    await rememberPickHistory({
      referenceTitle: 'PlayStation 5',
      marketplace: 'ozon',
      url: pickedUrl,
      title: 'Sony PlayStation 5',
    });

    type Row = { title: string; url: string };
    const candidates: Row[] = [
      { title: 'Sony PlayStation 5 Slim', url: otherUrl },
      { title: 'Sony PlayStation 5', url: pickedUrl },
    ];

    const withoutBoost = pickTopMatchesWithScore('PlayStation 5', candidates, (c) => c.title, {
      minScore: 0.3,
      getUrl: (c) => (c as Row).url,
      limit: 2,
    });

    const scoreBoostByUrl = await buildPickHistoryBoostMap('PlayStation 5', 'ozon', candidates);
    const withBoost = pickTopMatchesWithScore('PlayStation 5', candidates, (c) => c.title, {
      minScore: 0.3,
      getUrl: (c) => (c as Row).url,
      scoreBoostByUrl,
      limit: 2,
    });

    expect(withoutBoost[0]?.item.url).toBe(otherUrl);
    expect(withBoost[0]?.item.url).toBe(pickedUrl);
  });
});
