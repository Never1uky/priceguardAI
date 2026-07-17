/**
 * @vitest-environment happy-dom
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { extractVariantAttributes } from '@/lib/model-extract';
import {
  pickSearchFromCandidates,
  parseWildberriesSerpHtml,
  rankSearchCandidates,
  type SearchCandidate,
} from '@/utils/parsers/search-results';
import { AUTO_PICK_CONFIDENCE_THRESHOLD } from '@/lib/product-match';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, 'fixtures');
const wbSerpHtml = readFileSync(join(fixturesDir, 'wb-search-serp.html'), 'utf8');

const REFERENCE =
  'Xiaomi Смартфон Redmi 15 Ростест (EAC) 8/256 ГБ, Nano-SIM, черный';

describe('WB search SERP fixture', () => {
  it('парсит карточки из HTML выдачи', () => {
    const candidates = parseWildberriesSerpHtml(wbSerpHtml, 'Redmi 15');
    expect(candidates.length).toBe(3);
    expect(candidates[0].price).toBe(15_990);
    expect(candidates[0].url).toContain('/501001/');
  });

  it('ранжирует 8/256 чёрный выше 6/128 белого', () => {
    const candidates = parseWildberriesSerpHtml(wbSerpHtml, 'Redmi 15');
    const ranked = rankSearchCandidates(REFERENCE, candidates, { referencePrice: 15_990 });

    expect(ranked.length).toBeGreaterThanOrEqual(1);
    expect(ranked[0].candidate.url).toContain('501001');
    // Другая память/цвет либо ниже, либо отфильтрованы feature-matching
    const second = ranked[1];
    if (second) {
      expect(ranked[0].confidence).toBeGreaterThan(second.confidence);
      expect(second.candidate.url).not.toContain('501001');
    }
  });

  it('при низком confidence возвращает топ-3 для ручного выбора', () => {
    const blueRef = 'Xiaomi Смартфон Redmi 15 8/256 ГБ синий';
    const candidates: SearchCandidate[] = [
      {
        title: 'Xiaomi Redmi 15 8/256 черный',
        url: 'https://www.wildberries.ru/catalog/501001/detail.aspx',
        price: 15_990,
        rating: 4.7,
      },
      {
        title: 'Xiaomi Redmi 15 6/128 белый',
        url: 'https://www.wildberries.ru/catalog/501002/detail.aspx',
        price: 13_990,
        rating: 4.5,
      },
      {
        title: 'Xiaomi Redmi Note 14 8/256',
        url: 'https://www.wildberries.ru/catalog/501003/detail.aspx',
        price: 16_490,
        rating: null,
      },
    ];

    const result = pickSearchFromCandidates('wildberries', 'Redmi 15', blueRef, candidates, {
      referencePrice: 15_990,
    });

    expect(result.offer.searchCandidates?.length).toBeGreaterThan(0);
    expect(result.offer.searchCandidates!.length).toBeLessThanOrEqual(3);
    expect(
      result.offer.needsManualPick ||
        (result.offer.matchConfidence != null &&
          result.offer.matchConfidence < AUTO_PICK_CONFIDENCE_THRESHOLD),
    ).toBe(true);
  });

  it('автовыбирает при confidence ≥ 70%', () => {
    const candidates = parseWildberriesSerpHtml(wbSerpHtml, 'Redmi 15');
    const result = pickSearchFromCandidates('wildberries', 'Redmi 15 8/256', REFERENCE, candidates, {
      referencePrice: 15_990,
    });

    expect(result.offer.found).toBe(true);
    expect(result.offer.matchConfidence).toBeGreaterThanOrEqual(AUTO_PICK_CONFIDENCE_THRESHOLD);
    expect(result.offer.needsManualPick).toBeFalsy();
    expect(result.offer.matchStatus === 'verified' || result.offer.matchStatus === 'probable').toBe(
      true,
    );
    expect(result.offer.url).toContain('501001');
  });

  it('извлекает память и цвет из эталона', () => {
    const attrs = extractVariantAttributes(REFERENCE);
    expect(attrs.storage).toBe('8+256');
    expect(attrs.color).toBe('black');
  });
});
