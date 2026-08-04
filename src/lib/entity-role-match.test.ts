/**
 * Architectural entity-role match tests (not DualSense-only patches).
 */
import { describe, expect, it } from 'vitest';
import {
  buildPrimaryEntityQuery,
  extractEntityFromTitle,
  areEntityRolesIncompatible,
} from '@/lib/entity-extract';
import {
  getEffectiveSearchQuery,
  sanitizeCrossMarketplaceQuery,
} from '@/lib/compare-search-query';
import { inferProductCategory, isTitleCategoryCompatible } from '@/lib/match-category';
import { scoreProductMatch } from '@/lib/product-match';
import { extractProductModel } from '@/lib/model-extract';
import {
  getActiveCompiledRules,
  getBundledMatchRulePack,
  mergeMatchRulePacks,
  compileMatchRulePack,
} from '@/lib/match-rules';
import type { CompareProduct } from '@/types/comparison';

function stubProduct(title: string): CompareProduct {
  return {
    id: 'test',
    title,
    sourceMarketplace: 'wildberries',
    sourceUrl: 'https://www.wildberries.ru/catalog/1/detail.aspx',
    marketplaceUrls: {},
    addedAt: Date.now(),
    sourceOffer: {
      marketplace: 'wildberries',
      title,
      price: 1000,
      delivery: null,
      rating: null,
      url: 'https://www.wildberries.ru/catalog/1/detail.aspx',
      found: true,
    },
    marketplaceOffers: {},
  };
}

describe('match rule pack interface', () => {
  it('compiles bundled pack with version', () => {
    const pack = getBundledMatchRulePack();
    expect(pack.rulesVersion).toBeTruthy();
    const compiled = getActiveCompiledRules();
    expect(compiled.roleLexicon.length).toBeGreaterThan(0);
    expect(compiled.roleRelations.length).toBeGreaterThan(0);
  });

  it('merge overlay replaces lexicons when provided', () => {
    const base = getBundledMatchRulePack();
    const merged = mergeMatchRulePacks(base, {
      ...base,
      rulesVersion: '9.9.9',
      roleLexicon: base.roleLexicon.slice(0, 1),
    });
    expect(merged.rulesVersion).toBe('9.9.9');
    expect(merged.roleLexicon).toHaveLength(1);
    expect(compileMatchRulePack(merged).roleLexicon).toHaveLength(1);
  });
});

describe('entity roles: DualSense → not consoles', () => {
  const ref = 'Беспроводной контроллер DualSense для PlayStation 5';

  it('infers accessories, not consoles', () => {
    expect(inferProductCategory(ref)).toBe('accessories');
  });

  it('extracts DualSense primary and console host', () => {
    const e = extractEntityFromTitle(ref);
    expect(e.productRole).toBe('accessory');
    expect(e.hostFamily).toBe('console');
    expect(e.primaryEntity.toLowerCase()).toMatch(/dual\s*sense/);
    expect(e.compatibilityHost?.toLowerCase()).toMatch(/play\s*station|ps\s*5/);
  });

  it('query lead is DualSense, not PlayStation 5', () => {
    const e = extractEntityFromTitle(ref);
    const lead = buildPrimaryEntityQuery(e);
    expect(lead.toLowerCase()).toMatch(/dual\s*sense/);
    expect(lead.toLowerCase()).not.toMatch(/^play\s*station/);
    expect(sanitizeCrossMarketplaceQuery('PlayStation 5', ref).toLowerCase()).toMatch(
      /dual\s*sense/,
    );
    const q = getEffectiveSearchQuery(stubProduct(ref), 'ozon');
    expect(q.toLowerCase()).toMatch(/dual\s*sense/);
    expect(q.toLowerCase()).not.toBe('playstation 5');
    expect(extractProductModel(ref).searchQuery.toLowerCase()).toMatch(/dual\s*sense/);
  });

  it('PS5 Slim scores 0; DualSense controller scores high', () => {
    expect(scoreProductMatch(ref, 'PlayStation 5 Slim')).toBe(0);
    expect(areEntityRolesIncompatible(ref, 'PlayStation 5 Slim')).toBe(true);
    expect(isTitleCategoryCompatible(ref, 'PlayStation 5 Slim')).toBe(false);

    const good = scoreProductMatch(ref, 'Sony DualSense Wireless Controller');
    expect(good).toBeGreaterThan(0.4);
  });
});

describe('entity roles: phone case → not smartphone', () => {
  const ref = 'Чехол для iPhone 15 прозрачный';

  it('blocks smartphone host', () => {
    expect(inferProductCategory(ref)).toBe('accessories');
    const e = extractEntityFromTitle(ref);
    expect(e.productRole).toBe('accessory');
    expect(e.hostFamily).toBe('phone');
    expect(scoreProductMatch(ref, 'Смартфон Apple iPhone 15 128GB')).toBe(0);
    expect(areEntityRolesIncompatible(ref, 'Apple iPhone 15 Pro')).toBe(true);
  });
});

describe('entity roles: HP cartridge → not printer', () => {
  const ref = 'Картридж для принтера HP LaserJet Pro';

  it('blocks printer primary', () => {
    const e = extractEntityFromTitle(ref);
    expect(e.productRole).toBe('consumable');
    expect(e.hostFamily).toBe('printer');
    expect(scoreProductMatch(ref, 'Принтер HP LaserJet Pro MFP')).toBe(0);
    expect(areEntityRolesIncompatible(ref, 'HP LaserJet Pro принтер')).toBe(true);
  });
});

describe('entity roles: Dyson filter → not vacuum', () => {
  const ref = 'Фильтр для пылесоса Dyson V15 Detect';

  it('blocks vacuum primary', () => {
    const e = extractEntityFromTitle(ref);
    expect(e.productRole).toBe('part');
    expect(e.hostFamily).toBe('vacuum');
    expect(scoreProductMatch(ref, 'Пылесос Dyson V15 Detect Absolute')).toBe(0);
    expect(areEntityRolesIncompatible(ref, 'Dyson V15 пылесос')).toBe(true);
  });
});

describe('entity roles: Nespresso capsules → not coffee machine', () => {
  const ref = 'Капсулы для кофемашины Nespresso Arpeggio';

  it('blocks coffee machine primary', () => {
    const e = extractEntityFromTitle(ref);
    expect(e.productRole).toBe('supply');
    expect(e.hostFamily).toBe('coffee');
    expect(scoreProductMatch(ref, 'Кофемашина Nespresso Essenza Mini')).toBe(0);
    expect(areEntityRolesIncompatible(ref, 'Nespresso кофемашина')).toBe(true);
  });
});

describe('host primary wins over bundled accessory', () => {
  it('console + DualSense in title → primary, no контроллер in query', () => {
    const title =
      'Игровая приставка Sony PlayStation 5 Slim 1TB с дисководом + геймпад DualSense';
    const e = extractEntityFromTitle(title);
    expect(e.productRole).toBe('primary');
    expect(e.typeNoun).not.toBe('контроллер');
    expect(e.primaryEntity.toLowerCase()).toMatch(/play\s*station|ps\s*5/);
    expect(e.primaryEntity.toLowerCase()).not.toMatch(/dual\s*sense|контроллер/);

    const lead = buildPrimaryEntityQuery(e);
    expect(lead.toLowerCase()).not.toContain('контроллер');
    expect(lead.toLowerCase()).not.toMatch(/dual\s*sense/);

    const q = getEffectiveSearchQuery(stubProduct(title), 'wildberries');
    expect(q.toLowerCase()).not.toContain('контроллер');
  });

  it('console title + DualSense only in specs → primary', () => {
    const title = 'Игровая приставка Sony PlayStation 5 Slim 1TB';
    const specs = 'В комплекте беспроводной контроллер DualSense белый';
    const e = extractEntityFromTitle(title, specs);
    expect(e.productRole).toBe('primary');
    expect(e.typeNoun).not.toBe('контроллер');
    const q = getEffectiveSearchQuery(
      {
        ...stubProduct(title),
        sourceOffer: {
          ...stubProduct(title).sourceOffer!,
          specs,
        },
      },
      'ozon',
    );
    expect(q.toLowerCase()).not.toContain('контроллер');
  });

  it('real DualSense SKU stays accessory', () => {
    const ref = 'Беспроводной контроллер DualSense для PlayStation 5';
    const e = extractEntityFromTitle(ref);
    expect(e.productRole).toBe('accessory');
    expect(buildPrimaryEntityQuery(e).toLowerCase()).toMatch(/dual\s*sense|контроллер/);
  });

  it('smartphone with case in kit → primary, not чехол', () => {
    const title = 'Смартфон Apple iPhone 15 128GB чёрный в комплекте чехол';
    const e = extractEntityFromTitle(title);
    expect(e.productRole).toBe('primary');
    expect(e.typeNoun).not.toBe('чехол');
    expect(buildPrimaryEntityQuery(e).toLowerCase()).not.toContain('чехол');
  });

  it('phone case SKU stays accessory', () => {
    const ref = 'Чехол для iPhone 15 прозрачный';
    expect(extractEntityFromTitle(ref).productRole).toBe('accessory');
  });

  it('printer with cartridge in kit → primary, not картридж', () => {
    const title = 'Принтер HP LaserJet Pro MFP в комплекте картридж';
    const e = extractEntityFromTitle(title);
    expect(e.productRole).toBe('primary');
    expect(e.typeNoun).not.toBe('картридж');
  });

  it('cartridge SKU stays consumable', () => {
    const ref = 'Картридж для принтера HP LaserJet Pro';
    expect(extractEntityFromTitle(ref).productRole).toBe('consumable');
  });
});
