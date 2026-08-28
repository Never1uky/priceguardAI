/**
 * MEGA-9 — Megamarket CORE-parity regression pack (NO Telegram).
 *
 * Matrix gate: card / SERP / compare / track / refresh / cache / research / reviews / SEO.
 * Detailed parsers/SERP/match live in sibling tests; this file locks the integration contract.
 *
 * Run: `npm run test:mega`
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SEARCH_MARKETPLACE_IDS,
  getMarketplaceEntry,
  isCronPriceMonitoredMarketplace,
} from '@/lib/marketplaces/registry';
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

describe('MEGA-9 CORE-parity matrix (no Telegram)', () => {
  describe('card', () => {
    it('detects Mega product URL and canonicalizes host/path', () => {
      const raw =
        'https://www.sbermegamarket.ru/catalog/details/smartfon-google-pixel-10-100028123456/?utm=x';
      expect(detectMarketplace(raw)).toBe('megamarket');
      expect(isProductPage(raw)).toBe(true);
      expect(toCanonicalProductUrl(raw, 'megamarket')).toMatch(
        /^https:\/\/megamarket\.ru\/catalog\/details\//,
      );
      expect(toCanonicalProductUrl(raw, 'megamarket')).not.toContain('utm');
    });

    it('registry: card+search on, reviews OFF', () => {
      const mega = getMarketplaceEntry('megamarket');
      expect(mega?.supported).toBe(true);
      expect(mega?.enabledByDefault).toBe(true);
      expect(mega?.capabilities).toEqual({
        search: true,
        card: true,
        reviews: false,
        costTier: 'tab',
      });
    });
  });

  describe('SERP / compare / research', () => {
    it('defaults «Где искать» include Mega + Ali + M.Video with CORE trio', () => {
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

    it('Premium unlocker allowlist includes Mega (card-only Scrappey path)', () => {
      expect(isPremiumUnlockerMarketplace('megamarket')).toBe(true);
      expect(isPremiumUnlockerMarketplace('dns')).toBe(false);
    });

    it('compare-research VALID includes Mega when selected', () => {
      const source = 'wildberries';
      const selected = ['ozon', 'megamarket', 'dns'];
      const targets = COMPARE_RESEARCH_VALID.filter(
        (m) => m !== source && selected.includes(m),
      );
      expect(targets).toEqual(['ozon', 'megamarket']);
    });
  });

  describe('track / refresh / cache identity', () => {
    it('storage id is mm-{goodsId}, not yandex-', () => {
      const article = resolveProductArticle({
        marketplace: 'megamarket',
        id: 'mm-100028123456',
        url: 'https://megamarket.ru/catalog/details/foo-100028123456/',
      });
      expect(article).toBe('100028123456');
      expect(prefixedStorageId('megamarket', article)).toBe('mm-100028123456');
      expect(
        stableProductStorageId({
          marketplace: 'megamarket',
          url: 'https://megamarket.ru/catalog/details/foo-100028123456/',
        }),
      ).toBe('mm-100028123456');
    });

    it('client always refreshes Mega when CORE cron monitoring is active', () => {
      const rows = [
        { marketplace: 'wildberries', scrapedAt: NOW - HOUR },
        { marketplace: 'megamarket', scrapedAt: NOW - HOUR },
      ];
      const out = selectTrackedForClientRefresh(rows, {
        serverMonitoringActive: true,
        now: NOW,
      });
      expect(out.map((r) => r.marketplace)).toEqual(['megamarket']);
      expect(
        compareProductNeedsClientRefresh(
          {
            sourceMarketplace: 'wildberries',
            comparedAt: NOW - HOUR,
            marketplaceUrls: { megamarket: 'https://megamarket.ru/catalog/details/1/' },
            marketplaceOffers: {},
          },
          { serverMonitoringActive: true, now: NOW },
        ),
      ).toBe(true);
    });

    it('cron price monitoring excludes Mega (cache/cron never own Mega)', () => {
      expect(isCronPriceMonitoredMarketplace('wildberries')).toBe(true);
      expect(isCronPriceMonitoredMarketplace('megamarket')).toBe(false);
    });
  });

  describe('reviews (SKIP)', () => {
    it('capabilities.reviews stays false — no fake review scraper', () => {
      expect(getMarketplaceEntry('megamarket')?.capabilities.reviews).toBe(false);
    });
  });

  describe('SEO', () => {
    it('publishAllowed + offersAllowed; shortSlug mm / ae', () => {
      expect(isSeoPublishableMp('megamarket')).toBe(true);
      expect(isSeoPublishableMp('aliexpress')).toBe(true);
      expect(seoPublishableIds()).toContain('megamarket');
      expect(seoPublishableIds()).toContain('aliexpress');
      expect(seoOffersIds()).toContain('megamarket');
      expect(seoOffersIds()).toContain('aliexpress');
      expect(seoMpShort('megamarket')).toBe('mm');
      expect(seoMpShort('aliexpress')).toBe('ae');
    });

    it('gates still block thin Mega analysis (no auto-publish)', () => {
      const solid = {
        qualityScore: 8,
        qualitySummary: 'Хороший товар по отзывам.',
        verdictExplanation: 'Можно брать на скидке.',
        verdict: 'wait_discount',
        fakeRisk: 'low',
        webOverview: '',
        source: 'openai',
        pros: ['Звук', 'Автономность'],
        cons: ['Микрофон'],
      };
      expect(
        evaluateSeoPublishGates({
          analysis: solid,
          reviewCount: 0,
          title: 'Смартфон Google Pixel 10 128GB',
        }).reason,
      ).toBe('insufficient_reviews');
      expect(
        evaluateSeoPublishGates({
          analysis: { ...solid, webOverview: 'x'.repeat(SEO_MIN_WEB_OVERVIEW_LEN) },
          reviewCount: 0,
          title: 'Смартфон Google Pixel 10 128GB',
        }),
      ).toEqual({ ok: true });
    });
  });

  describe('OUT OF SCOPE — Telegram / monitoring', () => {
    it('client alerts skip Telegram for Mega', () => {
      expect(skipsTelegramAlertsForMarketplace('megamarket')).toBe(true);
      expect(skipsTelegramAlertsForMarketplace('aliexpress')).toBe(true);
      expect(skipsTelegramAlertsForMarketplace('wildberries')).toBe(false);
      expect(skipsTelegramAlertsForMarketplace('ozon')).toBe(false);
    });

    it('Mega is never a cron-monitored marketplace', () => {
      expect(isCronPriceMonitoredMarketplace('megamarket')).toBe(false);
      expect(isCronPriceMonitoredMarketplace('aliexpress')).toBe(false);
    });
  });
});
