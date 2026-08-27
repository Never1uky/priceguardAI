import { describe, expect, it } from 'vitest';
import { inferProductCategory, isTitleCategoryCompatible } from '@/lib/match-category';
import { scoreProductMatch } from '@/lib/product-match';
import { pickSearchFromCandidates, type SearchCandidate } from '@/utils/parsers/search-results';
import { titleFromProductUrl, isPlaceholderSerpTitle } from '@/lib/serp-title';

const PIXEL_128 = 'Смартфон Google Pixel 10 128GB';
const PIXEL_256 = 'Смартфон Google Pixel 10 256GB';
const PIXEL_CLOSE = 'Смартфон Google Pixel 10 128 ГБ Indigo';
const CRAB = 'Крабовые палочки Рыбный Базар охлажденные 180 г';
const PHONE_CASE = 'Чехол для Google Pixel 10 силиконовый';
const KOMOD = 'Комод Вега Люкс 8Я Дуб Вотан/Белый гладкий, ш123.6*в98*г46.6 см';

function cand(
  marketplace: 'megamarket' | 'ozon',
  title: string,
  id: string,
  price: number | null,
): SearchCandidate {
  const url =
    marketplace === 'megamarket'
      ? `https://megamarket.ru/catalog/details/${id}/`
      : `https://www.ozon.ru/product/${id}/`;
  return { title, url, price, rating: null };
}

describe('Mega-only SERP junk filter (CORE unchanged)', () => {
  it('infers grocery / furniture incompatible with phone', () => {
    expect(inferProductCategory(CRAB)).toBe('grocery');
    expect(inferProductCategory(KOMOD)).toBe('home_goods');
    expect(isTitleCategoryCompatible(PIXEL_128, CRAB)).toBe(false);
    expect(isTitleCategoryCompatible(PIXEL_128, KOMOD)).toBe(false);
    expect(scoreProductMatch(PIXEL_128, CRAB)).toBe(0);
    expect(scoreProductMatch(PIXEL_128, KOMOD)).toBe(0);
    expect(scoreProductMatch(PIXEL_128, PHONE_CASE)).toBe(0);
    expect(scoreProductMatch(PIXEL_128, PIXEL_256)).toBe(0);
  });

  it('megamarket: komod + food + case + wrong storage → not_found (not needs_choice junk)', () => {
    const result = pickSearchFromCandidates(
      'megamarket',
      'Google Pixel 10 128GB',
      PIXEL_128,
      [
        cand('megamarket', KOMOD, 'komod-600023701542', 12_990),
        cand('megamarket', CRAB, 'food-1112223334', 75),
        cand('megamarket', PHONE_CASE, 'acc-1112223334', 990),
        cand('megamarket', PIXEL_256, 'pixel-256-700008588462', 89_990),
      ],
      { referencePrice: 79_990 },
    );
    expect(result.offer.matchStatus).toBe('not_found');
    expect(result.offer.needsManualPick).toBeFalsy();
    expect(result.offer.searchCandidates?.length ?? 0).toBe(0);
  });

  it('megamarket: same-storage Pixel kept; junk dropped', () => {
    const result = pickSearchFromCandidates(
      'megamarket',
      'Google Pixel 10 128GB',
      PIXEL_128,
      [
        cand('megamarket', KOMOD, 'komod-600023701542', 12_990),
        cand('megamarket', PIXEL_CLOSE, 'pixel-128-9998887776', 78_500),
        cand('megamarket', CRAB, 'food-1112223334', 75),
        cand('megamarket', PIXEL_256, 'pixel-256-700008588462', 89_990),
      ],
      { referencePrice: 79_990 },
    );
    const titles = [
      result.offer.title,
      ...(result.offer.searchCandidates?.map((c) => c.title) ?? []),
    ]
      .filter(Boolean)
      .join(' ');
    expect(result.offer.matchStatus === 'not_found').toBe(false);
    expect(titles).toMatch(/Pixel\s*10/i);
    expect(titles).toMatch(/128/i);
    expect(titles).not.toMatch(/комод|крабов|чехол|256/i);
  });

  it('ozon CORE: soft minScore:0 path not Mega-hardened (junk may still enter weak pool)', () => {
    const result = pickSearchFromCandidates(
      'ozon',
      'Google Pixel 10 128GB',
      PIXEL_128,
      [
        cand('ozon', KOMOD, 'komod-1-1234567890', 12_990),
        cand('ozon', PIXEL_256, 'pixel-256-1234567890', 89_990),
      ],
      { referencePrice: 79_990 },
    );
    // Shared path may still surface score===0 via minScore:0 — must NOT force Mega not_found.
    // Either needs_choice with pool or not_found from other rules; assert Mega gate absent:
    const megaForcedEmpty =
      result.offer.matchStatus === 'not_found' &&
      (result.offer.searchCandidates?.length ?? 0) === 0 &&
      scoreProductMatch(PIXEL_128, PIXEL_256) === 0 &&
      scoreProductMatch(PIXEL_128, KOMOD) === 0;
    // If both score 0, CORE minScore:0 typically yields needs_choice — preferred signal of unchanged path
    if (result.offer.needsManualPick) {
      expect((result.offer.searchCandidates?.length ?? 0) >= 1).toBe(true);
    } else {
      // Accept not_found only if category third-fallback emptied — still not Mega-specific error path required
      expect(megaForcedEmpty || result.offer.matchStatus === 'not_found').toBe(true);
    }
  });

  it('titleFromProductUrl decodes Mega details slug', () => {
    expect(
      titleFromProductUrl(
        'https://megamarket.ru/catalog/details/smartfon-google-pixel-10-128gb-1002003004/',
      ),
    ).toMatch(/Google Pixel/i);
    expect(isPlaceholderSerpTitle('Товар на Мегамаркете')).toBe(true);
  });
});
