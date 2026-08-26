import { describe, expect, it } from 'vitest';
import { resolveMonitoringKey } from './monitoring-key.ts';

describe('monitoring-key', () => {
  it('ozon+12345 is the canonical example key', () => {
    expect(
      resolveMonitoringKey({
        marketplace: 'ozon',
        productId: '12345',
      })?.key,
    ).toBe('ozon:12345');
  });

  it('WB/YM URL variants collapse to same key', () => {
    expect(
      resolveMonitoringKey({
        marketplace: 'wildberries',
        productId: '',
        productUrl: 'https://www.wildberries.ru/catalog/12345678/detail.aspx?targetUrl=GP',
      })?.key,
    ).toBe('wildberries:12345678');

    expect(
      resolveMonitoringKey({
        marketplace: 'yandex_market',
        productId: '',
        productUrl: 'https://market.yandex.ru/card/some-slug/987654321?utm=1',
      })?.key,
    ).toBe('yandex_market:987654321');
  });

  it('megamarket is not a monitoring key (no Telegram scrape job)', () => {
    expect(
      resolveMonitoringKey({
        marketplace: 'megamarket',
        productId: '1002003004',
        productUrl: 'https://megamarket.ru/catalog/details/1002003004/',
      }),
    ).toBeNull();
  });
});