/**
 * ALI-9 — AliExpress CORE-parity regression pack (NO Telegram).
 *
 * Matrix gate: card / SERP / compare / track / refresh / cache / research / reviews / SEO.
 * Detailed parsers/SERP live in sibling tests; this file locks the integration contract.
 *
 * Run: `npm run test:ali`
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
import { isGenericCardMarketplace } from '@/lib/marketplaces/adapter-config';

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

describe('ALI-9 CORE-parity matrix (no Telegram)', () => {
  describe('card', () => {
    it('detects Ali product URL and canonicalizes host/path', () => {
      const raw = 'https://aliexpress.ru/item/1005001234567890.html?spm=a2g2w.detail';
      expect(detectMarketplace(raw)).toBe('aliexpress');
      expect(isProductPage(raw)).toBe(true);
      expect(toCanonicalProductUrl(raw, 'aliexpress')).toBe(
        'https://aliexpress.ru/item/1005001234567890.html',
      );
      expect(toCanonicalProductUrl(raw, 'aliexpress')).not.toContain('spm');
      expect(isGenericCardMarketplace('aliexpress')).toBe(false);
    });

    it('registry: card+search on, reviews tab-DOM on', () => {
      const ali = getMarketplaceEntry('aliexpress');
      expect(ali?.supported).toBe(true);
      expect(ali?.enabledByDefault).toBe(true);
      expect(ali?.capabilities).toEqual({
        search: true,
        card: true,
        reviews: true,
        costTier: 'tab',
      });
    });
  });

  describe('SERP / compare / research', () => {
    it('defaults «Где искать» include Ali + Mega + M.Video with CORE trio', () => {
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

    it('Premium unlocker allowlist includes Ali (card-only Scrappey path)', () => {
      expect(isPremiumUnlockerMarketplace('aliexpress')).toBe(true);
      expect(isPremiumUnlockerMarketplace('dns')).toBe(false);
    });

    it('compare-research VALID includes Ali when selected', () => {
      const source = 'wildberries';
      const selected = ['ozon', 'aliexpress', 'dns'];
      const targets = COMPARE_RESEARCH_VALID.filter(
        (m) => m !== source && selected.includes(m),
      );
      expect(targets).toEqual(['ozon', 'aliexpress']);
    });
  });

  describe('track / refresh / cache identity', () => {
    it('storage id is ae-{itemId}, not yandex- / aliexpress-', () => {
      const article = resolveProductArticle({
        marketplace: 'aliexpress',
        id: 'ae-1005001234567890',
        url: 'https://aliexpress.ru/item/1005001234567890.html',
      });
      expect(article).toBe('1005001234567890');
      expect(prefixedStorageId('aliexpress', article)).toBe('ae-1005001234567890');
      expect(
        stableProductStorageId({
          marketplace: 'aliexpress',
          url: 'https://aliexpress.ru/item/1005001234567890.html?x=1',
        }),
      ).toBe('ae-1005001234567890');
    });

    it('client always refreshes Ali when CORE cron monitoring is active', () => {
      const rows = [
        { marketplace: 'wildberries', scrapedAt: NOW - HOUR },
        { marketplace: 'aliexpress', scrapedAt: NOW - HOUR },
      ];
      const out = selectTrackedForClientRefresh(rows, {
        serverMonitoringActive: true,
        now: NOW,
      });
      expect(out.map((r) => r.marketplace)).toEqual(['aliexpress']);
      expect(
        compareProductNeedsClientRefresh(
          {
            sourceMarketplace: 'wildberries',
            comparedAt: NOW - HOUR,
            marketplaceUrls: {
              aliexpress: 'https://aliexpress.ru/item/1005001234567890.html',
            },
            marketplaceOffers: {},
          },
          { serverMonitoringActive: true, now: NOW },
        ),
      ).toBe(true);
    });

    it('cron price monitoring excludes Ali (cache/cron never own Ali)', () => {
      expect(isCronPriceMonitoredMarketplace('wildberries')).toBe(true);
      expect(isCronPriceMonitoredMarketplace('aliexpress')).toBe(false);
    });
  });

  describe('reviews (tab DOM)', () => {
    it('capabilities.reviews true — Ali card DOM path (no Scrappey)', () => {
      expect(getMarketplaceEntry('aliexpress')?.capabilities.reviews).toBe(true);
    });
  });

  describe('SEO', () => {
    it('publishAllowed + offersAllowed; shortSlug ae', () => {
      expect(isSeoPublishableMp('aliexpress')).toBe(true);
      expect(seoPublishableIds()).toContain('aliexpress');
      expect(seoOffersIds()).toContain('aliexpress');
      expect(seoMpShort('aliexpress')).toBe('ae');
    });

    it('gates still block thin Ali analysis (no auto-publish)', () => {
      const solid = {
        qualityScore: 8,
        qualitySummary: 'Хороший товар по отзывам.',
        verdictExplanation: 'Можно брать на скидке.',
        verdict: 'wait_discount',
        fakeRisk: 'low',
        webOverview: '',
        source: 'openai',
        pros: ['Цена', 'Доставка'],
        cons: ['Срок'],
      };
      expect(
        evaluateSeoPublishGates({
          analysis: solid,
          reviewCount: 0,
          title: 'Кабель USB-C AliExpress',
        }).reason,
      ).toBe('insufficient_reviews');
      expect(
        evaluateSeoPublishGates({
          analysis: { ...solid, webOverview: 'x'.repeat(SEO_MIN_WEB_OVERVIEW_LEN) },
          reviewCount: 0,
          title: 'Кабель USB-C AliExpress',
        }),
      ).toEqual({ ok: true });
    });
  });

  describe('OUT OF SCOPE — Telegram / monitoring', () => {
    it('client alerts skip Telegram for Ali', () => {
      expect(skipsTelegramAlertsForMarketplace('aliexpress')).toBe(true);
      expect(skipsTelegramAlertsForMarketplace('megamarket')).toBe(true);
      expect(skipsTelegramAlertsForMarketplace('wildberries')).toBe(false);
      expect(skipsTelegramAlertsForMarketplace('ozon')).toBe(false);
    });

    it('Ali is never a cron-monitored marketplace', () => {
      expect(isCronPriceMonitoredMarketplace('aliexpress')).toBe(false);
    });
  });
});
