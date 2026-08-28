/**
 * MVIDEO-9 — М.Видео CORE-parity regression pack (NO Telegram).
 *
 * Matrix gate: card / SERP / compare / track / refresh / cache / research / reviews / SEO.
 * Detailed parsers/SERP live in sibling tests; this file locks the integration contract.
 *
 * Run: `npm run test:mvideo`
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SEARCH_MARKETPLACE_IDS,
  getMarketplaceEntry,
  isCronPriceMonitoredMarketplace,
} from '@/lib/marketplaces/registry';
import { isGenericCardMarketplace } from '@/lib/marketplaces/adapter-config';
import { isPremiumUnlockerMarketplace } from '@/lib/premium-unlocker-offer';
import { skipsTelegramAlertsForMarketplace } from '@/lib/price-alert-dispatch';
import { prefixedStorageId, resolveProductArticle, stableProductStorageId } from '@/lib/price-identity';
import {
  compareProductNeedsClientRefresh,
  selectTrackedForClientRefresh,
} from '@/lib/tracked-client-refresh';
import { evaluateSeoPublishGates, SEO_MIN_WEB_OVERVIEW_LEN } from '@/lib/seo/publish-gates';
import { isSeoPublishableMp, seoMpShort, seoOffersIds, seoPublishableIds } from '@/lib/seo/seo-marketplaces';
import { toCanonicalProductUrl } from '@/utils/product-url';
import { detectMarketplace, isProductPage } from '@/utils/marketplace';

const NOW = 1_700_000_000_000;
const HOUR = 60 * 60 * 1000;

/** Mirrors Edge compare-research VALID ∩ selected. */
const COMPARE_RESEARCH_VALID = [
  'wildberries',
  'ozon',
  'yandex_market',
  'megamarket',
  'aliexpress',
  'mvideo',
] as const;

describe('MVIDEO-9 CORE-parity matrix (no Telegram)', () => {
  describe('card', () => {
    it('detects M.Video + Eldorado product URLs and canonicalizes host/path', () => {
      const mvideoRaw =
        'https://mvideo.ru/products/smartfon-apple-iphone-15-30066712?utm=x';
      expect(detectMarketplace(mvideoRaw)).toBe('mvideo');
      expect(isProductPage(mvideoRaw)).toBe(true);
      expect(toCanonicalProductUrl(mvideoRaw, 'mvideo')).toBe(
        'https://www.mvideo.ru/products/smartfon-apple-iphone-15-30066712',
      );
      expect(toCanonicalProductUrl(mvideoRaw, 'mvideo')).not.toContain('utm');

      const eldoRaw = 'https://www.eldorado.ru/cat/detail/phone-12345678/?x=1';
      expect(detectMarketplace(eldoRaw)).toBe('mvideo');
      expect(isProductPage(eldoRaw)).toBe(true);
      expect(toCanonicalProductUrl(eldoRaw, 'mvideo')).toBe(
        'https://www.eldorado.ru/cat/detail/phone-12345678',
      );
    });

    it('registry: card+search on, reviews OFF (MVIDEO-7 SKIP)', () => {
      const mv = getMarketplaceEntry('mvideo');
      expect(mv?.supported).toBe(true);
      expect(mv?.enabledByDefault).toBe(true);
      expect(mv?.capabilities).toEqual({
        search: true,
        card: true,
        reviews: false,
        costTier: 'tab',
      });
      expect(isGenericCardMarketplace('mvideo')).toBe(false);
    });
  });

  describe('SERP / compare / research', () => {
    it('defaults «Где искать» include M.Video with CORE trio + Mega + Ali', () => {
      expect(DEFAULT_SEARCH_MARKETPLACE_IDS).toEqual(
        expect.arrayContaining([
          'wildberries',
          'ozon',
          'yandex_market',
          'megamarket',
          'aliexpress',
          'mvideo',
        ]),
      );
      expect(DEFAULT_SEARCH_MARKETPLACE_IDS).toHaveLength(6);
    });

    it('Premium unlocker allowlist includes M.Video (card-only Scrappey path)', () => {
      expect(isPremiumUnlockerMarketplace('mvideo')).toBe(true);
      expect(isPremiumUnlockerMarketplace('dns')).toBe(false);
    });

    it('compare-research VALID includes mvideo when selected', () => {
      const source = 'wildberries';
      const selected = ['ozon', 'mvideo', 'dns'];
      const targets = COMPARE_RESEARCH_VALID.filter(
        (m) => m !== source && selected.includes(m),
      );
      expect(targets).toEqual(['ozon', 'mvideo']);
    });

    it('source mvideo may research trio + mega + ali when selected', () => {
      const targets = COMPARE_RESEARCH_VALID.filter(
        (m) =>
          m !== 'mvideo' &&
          ['wildberries', 'ozon', 'megamarket', 'aliexpress'].includes(m),
      ).sort();
      expect(targets).toEqual(['aliexpress', 'megamarket', 'ozon', 'wildberries']);
    });
  });

  describe('track / refresh / cache identity', () => {
    it('storage id is mv-{article}, not yandex- / mvideo-', () => {
      const article = resolveProductArticle({
        marketplace: 'mvideo',
        id: 'mv-30066712',
        url: 'https://www.mvideo.ru/products/smartfon-30066712',
      });
      expect(article).toBe('30066712');
      expect(prefixedStorageId('mvideo', article)).toBe('mv-30066712');
      expect(
        stableProductStorageId({
          marketplace: 'mvideo',
          url: 'https://www.mvideo.ru/products/smartfon-30066712?utm=1',
        }),
      ).toBe('mv-30066712');
    });

    it('client always refreshes M.Video when CORE cron monitoring is active', () => {
      const rows = [
        { marketplace: 'wildberries', scrapedAt: NOW - HOUR },
        { marketplace: 'mvideo', scrapedAt: NOW - HOUR },
      ];
      const out = selectTrackedForClientRefresh(rows, {
        serverMonitoringActive: true,
        now: NOW,
      });
      expect(out.map((r) => r.marketplace)).toEqual(['mvideo']);
      expect(
        compareProductNeedsClientRefresh(
          {
            sourceMarketplace: 'wildberries',
            comparedAt: NOW - HOUR,
            marketplaceUrls: {
              mvideo: 'https://www.mvideo.ru/products/smartfon-30066712',
            },
            marketplaceOffers: {},
          },
          { serverMonitoringActive: true, now: NOW },
        ),
      ).toBe(true);
      expect(
        compareProductNeedsClientRefresh(
          {
            sourceMarketplace: 'mvideo',
            comparedAt: NOW - HOUR,
            marketplaceUrls: {},
            marketplaceOffers: {},
          },
          { serverMonitoringActive: true, now: NOW },
        ),
      ).toBe(true);
    });

    it('cron price monitoring excludes M.Video (cache/cron never own mvideo)', () => {
      expect(isCronPriceMonitoredMarketplace('wildberries')).toBe(true);
      expect(isCronPriceMonitoredMarketplace('mvideo')).toBe(false);
    });
  });

  describe('reviews (SKIP)', () => {
    it('capabilities.reviews stays false — MVIDEO-7 documented SKIP', () => {
      expect(getMarketplaceEntry('mvideo')?.capabilities.reviews).toBe(false);
    });
  });

  describe('SEO', () => {
    it('publishAllowed + offersAllowed; shortSlug mvideo', () => {
      expect(isSeoPublishableMp('mvideo')).toBe(true);
      expect(seoPublishableIds()).toContain('mvideo');
      expect(seoOffersIds()).toContain('mvideo');
      expect(seoMpShort('mvideo')).toBe('mvideo');
    });

    it('gates still block thin M.Video analysis (no auto-publish)', () => {
      const solid = {
        qualityScore: 8,
        qualitySummary: 'Хороший товар по отзывам.',
        verdictExplanation: 'Можно брать на скидке.',
        verdict: 'wait_discount',
        fakeRisk: 'low',
        webOverview: '',
        source: 'openai',
        pros: ['Экран', 'Камера'],
        cons: ['Цена'],
      };
      expect(
        evaluateSeoPublishGates({
          analysis: solid,
          reviewCount: 0,
          title: 'Смартфон Apple iPhone 15 128GB',
        }).reason,
      ).toBe('insufficient_reviews');
      expect(
        evaluateSeoPublishGates({
          analysis: { ...solid, webOverview: 'x'.repeat(SEO_MIN_WEB_OVERVIEW_LEN) },
          reviewCount: 0,
          title: 'Смартфон Apple iPhone 15 128GB',
        }),
      ).toEqual({ ok: true });
    });
  });

  describe('OUT OF SCOPE — Telegram / monitoring', () => {
    it('client alerts skip Telegram for M.Video', () => {
      expect(skipsTelegramAlertsForMarketplace('mvideo')).toBe(true);
      expect(skipsTelegramAlertsForMarketplace('megamarket')).toBe(true);
      expect(skipsTelegramAlertsForMarketplace('wildberries')).toBe(false);
      expect(skipsTelegramAlertsForMarketplace('ozon')).toBe(false);
    });

    it('M.Video is never a cron-monitored marketplace', () => {
      expect(isCronPriceMonitoredMarketplace('mvideo')).toBe(false);
      expect(isCronPriceMonitoredMarketplace('megamarket')).toBe(false);
      expect(isCronPriceMonitoredMarketplace('aliexpress')).toBe(false);
    });
  });
});
