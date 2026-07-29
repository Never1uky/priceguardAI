import { describe, expect, it } from 'vitest';
import { buildPriceDropMessage, buildStatusMessage, buildTargetPriceMessage } from './telegram.ts';

describe('telegram alert priority label', () => {
  it('Free: no Premium priority suffix', () => {
    const drop = buildPriceDropMessage({
      title: 'Товар',
      oldPrice: 1000,
      newPrice: 800,
      priority: false,
    });
    expect(drop).toContain('Цена упала на площадке!');
    expect(drop).toContain('серверная проверка');
    expect(drop).not.toContain('приоритет Premium');

    const target = buildTargetPriceMessage({
      title: 'Товар',
      currentPrice: 800,
      targetPrice: 900,
      priority: false,
    });
    expect(target).not.toContain('приоритет Premium');
    expect(target).toContain('серверная проверка');
  });

  it('Premium: shows priority suffix', () => {
    const drop = buildPriceDropMessage({
      title: 'Товар',
      oldPrice: 1000,
      newPrice: 800,
      priority: true,
    });
    expect(drop).toContain('(приоритет Premium)');
  });

  it('Free /status: shows monitor limit and orphan hint', () => {
    const msg = buildStatusMessage(
      [{ title: 'Товар A', lastPrice: 100 }],
      { totalCount: 10, freeLimit: 5 },
    );
    expect(msg).toContain('1 из 5');
    expect(msg).toContain('на сервере 10');
    expect(msg).toContain('Обновить');
    expect(msg).toContain('серверной проверке');
  });
});
