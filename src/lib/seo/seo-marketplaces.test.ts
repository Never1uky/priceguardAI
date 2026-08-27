import { describe, expect, it } from 'vitest';
import {
  isSeoPublishableMp,
  seoAllShortSlugs,
  seoMpShort,
  seoOffersIds,
  seoPublishableIds,
  SEO_MARKETPLACES,
} from './seo-marketplaces';
import { sanitizeSeoProductTitle } from './publish-gates';
import { buildSeoProductSlug, resolveSeoSlugCollision } from './slug';

describe('seo-marketplaces allowlist', () => {
  it('shortSlug values are unique', () => {
    const shorts = seoAllShortSlugs();
    expect(new Set(shorts).size).toBe(shorts.length);
  });

  it('publishable + offers include CORE trio + megamarket + aliexpress (MEGA-8 / ALI-8)', () => {
    expect(seoPublishableIds().sort()).toEqual(
      ['aliexpress', 'megamarket', 'ozon', 'wildberries', 'yandex_market'].sort(),
    );
    expect(seoOffersIds().sort()).toEqual(
      ['aliexpress', 'megamarket', 'ozon', 'wildberries', 'yandex_market'].sort(),
    );
    expect(isSeoPublishableMp('megamarket')).toBe(true);
    expect(isSeoPublishableMp('aliexpress')).toBe(true);
    expect(isSeoPublishableMp('lamoda')).toBe(false);
    expect(isSeoPublishableMp('wildberries')).toBe(true);
  });

  it('wired new MPs have shortSlug from plan', () => {
    expect(seoMpShort('megamarket')).toBe('mm');
    expect(seoMpShort('aliexpress')).toBe('ae');
    expect(seoMpShort('citilink')).toBe('citi');
    expect(seoMpShort('unknown_mp')).toBe('mp');
  });

  it('every entry has at least one titleStrip alias', () => {
    for (const e of SEO_MARKETPLACES) {
      expect(e.titleStripAliases.length).toBeGreaterThan(0);
    }
  });
});

describe('seo slug collision with new shorts', () => {
  it('fallback slug uses mm/ae for Mega/Ali', () => {
    expect(
      buildSeoProductSlug({
        marketplace: 'megamarket',
        productId: '12345',
      }),
    ).toBe('mm-12345');
    expect(
      buildSeoProductSlug({
        marketplace: 'aliexpress',
        productId: '1005001234567890',
      }),
    ).toBe('ae-1005001234567890');
  });

  it('collision append distinguishes wb vs mm vs ae', () => {
    const base = 'samsung-galaxy';
    const wb = resolveSeoSlugCollision(base, true, 'wildberries', '111', 0);
    const mm = resolveSeoSlugCollision(base, true, 'megamarket', '222', 0);
    const ae = resolveSeoSlugCollision(base, true, 'aliexpress', '333', 0);
    expect(wb).toBe('samsung-galaxy-wb');
    expect(mm).toBe('samsung-galaxy-mm');
    expect(ae).toBe('samsung-galaxy-ae');
    expect(new Set([wb, mm, ae]).size).toBe(3);
  });
});

describe('sanitizeSeoProductTitle new MP labels', () => {
  it('still strips classic trio', () => {
    expect(sanitizeSeoProductTitle('AirPods Max | Wildberries')).toBe('AirPods Max');
    expect(sanitizeSeoProductTitle('Ozon: Кроссовки Nike')).toBe('Кроссовки Nike');
    expect(sanitizeSeoProductTitle('Наушники — Яндекс Маркет')).toBe('Наушники');
  });

  it('strips megamarket / lamoda / mvideo / citilink labels', () => {
    expect(sanitizeSeoProductTitle('Моноблок CHUWI | Мегамаркет')).toBe('Моноблок CHUWI');
    expect(sanitizeSeoProductTitle('Lamoda: Куртка зимняя')).toBe('Куртка зимняя');
    expect(sanitizeSeoProductTitle('Телевизор — М.Видео')).toBe('Телевизор');
    expect(sanitizeSeoProductTitle('SSD | Ситилинк')).toBe('SSD');
    expect(sanitizeSeoProductTitle('AliExpress: Кабель USB')).toBe('Кабель USB');
  });
});
