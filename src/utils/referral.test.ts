import { describe, expect, it } from 'vitest';
import { applyReferralParams, makeReferralLink } from '@/utils/referral';
import type { ReferralSettings } from '@/lib/referral-settings';

const settings: ReferralSettings = {
  wildberriesPartnerId: 'wb-partner-123',
  ozonTag: 'ozon-tag-456',
  yandexMarketClid: '78901234',
};

describe('applyReferralParams', () => {
  it('adds partner to Wildberries', () => {
    const url = applyReferralParams(
      'https://www.wildberries.ru/catalog/123/detail.aspx',
      settings,
      'wildberries',
    );
    expect(url).toContain('partner=wb-partner-123');
  });

  it('adds partner and utm_campaign to Ozon', () => {
    const url = applyReferralParams(
      'https://www.ozon.ru/product/foo-123/',
      settings,
      'ozon',
    );
    expect(url).toContain('partner=ozon-tag-456');
    expect(url).toContain('utm_campaign=ozon-tag-456');
  });

  it('adds clid to Yandex Market', () => {
    const url = applyReferralParams(
      'https://market.yandex.ru/product/123',
      settings,
      'yandex_market',
    );
    expect(url).toContain('clid=78901234');
  });

  it('returns url unchanged when settings empty', () => {
    const base = 'https://www.wildberries.ru/catalog/1/detail.aspx';
    expect(
      applyReferralParams(base, { wildberriesPartnerId: '', ozonTag: '', yandexMarketClid: '' }, 'wildberries'),
    ).toBe(base);
  });
});

describe('makeReferralLink', () => {
  it('normalizes WB feedbacks and adds partner', () => {
    const url = makeReferralLink(
      'https://www.wildberries.ru/catalog/292619464/feedbacks',
      'wildberries',
      settings,
    );
    expect(url).toContain('/detail.aspx');
    expect(url).toContain('partner=wb-partner-123');
  });
});
