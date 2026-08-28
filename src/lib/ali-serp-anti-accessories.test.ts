import { describe, expect, it } from 'vitest';
import { inferProductCategory } from '@/lib/match-category';
import { scoreProductMatch } from '@/lib/product-match';
import { matchConfidencePercent } from '@/lib/fuzzy-match';
import { buildOfferFromRankedCandidates } from '@/lib/search-offer-from-candidates';
import type { MarketplaceOffer } from '@/types/comparison';

/** Live/repro Ali wholesale patterns: accessory-heavy SERP vs primary device ref. */
const FIXTURES: Array<{ ref: string; junk: string; label: string }> = [
  {
    label: 'EN soft case vs Xiaomi phone',
    ref: 'Смартфон Xiaomi 14 12/256GB черный',
    junk: 'Soft TPU Case Cover for Xiaomi 14 Pro Ultra Thin',
  },
  {
    label: 'EN silicone case vs iPhone',
    ref: 'Смартфон Apple iPhone 15 Pro 256GB',
    junk: 'Silicone Case for iPhone 15 Pro Max Luxury Cover',
  },
  {
    label: 'EN tempered glass vs Galaxy',
    ref: 'Смартфон Samsung Galaxy S24 Ultra 256GB',
    junk: 'Tempered Glass Screen Protector for Samsung Galaxy S24 Ultra',
  },
  {
    label: 'EN USB cable/charger vs Pixel',
    ref: 'Смартфон Google Pixel 8 Pro 128GB',
    junk: 'USB-C Fast Charging Cable Charger Adapter for Google Pixel 8',
  },
  {
    label: 'EN laptop sleeve vs notebook',
    ref: 'Ноутбук ASUS VivoBook 15 Intel Core i5',
    junk: 'Laptop Sleeve Bag 15.6 inch Soft Case for ASUS Notebook',
  },
];

function offerShell(title: string, url: string, price: number): MarketplaceOffer {
  return {
    marketplace: 'aliexpress',
    title,
    price,
    delivery: null,
    rating: null,
    url,
    found: true,
  };
}

describe('Ali SERP anti-accessories (primary device vs junk)', () => {
  it.each(FIXTURES)('$label → cand is accessories, score 0', ({ ref, junk }) => {
    expect(inferProductCategory(ref)).not.toBe('accessories');
    expect(inferProductCategory(junk)).toBe('accessories');
    expect(scoreProductMatch(ref, junk)).toBe(0);
  });

  it('still allows accessory vs accessory search', () => {
    const ref = 'Чехол силиконовый для iPhone 15 Pro';
    const cand = 'Silicone Case for iPhone 15 Pro Soft Cover';
    expect(inferProductCategory(ref)).toBe('accessories');
    expect(inferProductCategory(cand)).toBe('accessories');
    expect(scoreProductMatch(ref, cand)).toBeGreaterThan(0);
  });

  it('still matches phone vs phone on Ali-like titles', () => {
    const ref = 'Смартфон Xiaomi 14 256GB';
    const cand = 'Xiaomi 14 Global Version 256GB Smartphone';
    expect(inferProductCategory(cand)).toBe('smartphones');
    expect(scoreProductMatch(ref, cand)).toBeGreaterThan(0);
  });

  it('accessory-only SERP → not verified auto-pick', () => {
    const ref = 'Смартфон Xiaomi 14 256GB';
    const junkTitles = [
      'Soft TPU Case Cover for Xiaomi 14 Pro',
      'Silicone Case for Xiaomi 14',
      'Tempered Glass Screen Protector for Xiaomi 14',
    ];
    const scored = junkTitles.map((title, i) => ({
      confidence: matchConfidencePercent(scoreProductMatch(ref, title)),
      offer: offerShell(title, `https://aliexpress.ru/item/100500111122233${i}.html`, 299 + i),
    }));
    const offer = buildOfferFromRankedCandidates(
      'aliexpress',
      ref,
      'https://aliexpress.ru/wholesale?SearchText=xiaomi',
      scored,
      ref,
      45_000,
    );
    expect(offer.matchStatus).toBe('not_found');
    expect(offer.found).toBe(false);
    expect(offer.needsManualPick).toBeFalsy();
  });

  it('mixed SERP drops accessories and keeps phone for picker/cascade', () => {
    const ref = 'Смартфон Xiaomi 14 256GB';
    const phone = 'Xiaomi 14 Global Version 256GB Smartphone';
    const scored = [
      {
        confidence: matchConfidencePercent(scoreProductMatch(ref, 'Soft TPU Case for Xiaomi 14')),
        offer: offerShell(
          'Soft TPU Case for Xiaomi 14',
          'https://aliexpress.ru/item/1005001111222330.html',
          350,
        ),
      },
      {
        confidence: matchConfidencePercent(scoreProductMatch(ref, phone)),
        offer: offerShell(phone, 'https://aliexpress.ru/item/1005009999888777.html', 42_000),
      },
    ];
    const offer = buildOfferFromRankedCandidates(
      'aliexpress',
      ref,
      'https://aliexpress.ru/wholesale?SearchText=xiaomi',
      scored,
      ref,
      45_000,
    );
    expect(offer.matchStatus).not.toBe('not_found');
    if (offer.searchCandidates?.length) {
      expect(offer.searchCandidates.every((c) => !/case|cover|protector/i.test(c.title))).toBe(
        true,
      );
      expect(offer.searchCandidates.some((c) => /xiaomi 14/i.test(c.title))).toBe(true);
    } else {
      // Unambiguous phone left after accessory drop → verified auto-pick OK
      expect(offer.matchStatus).toBe('verified');
      expect(offer.title).toMatch(/xiaomi 14/i);
      expect(offer.url).toContain('1005009999888777');
    }
  });
});
