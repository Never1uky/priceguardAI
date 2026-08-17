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

  it('из nmId заполняет imageUrl (basket CDN) и alternatives', () => {
    const candidates = parseWildberriesSerpHtml(wbSerpHtml, 'Redmi 15');
    const first = candidates[0];
    expect(first?.imageUrl).toBeTruthy();
    expect(first!.imageUrl).toMatch(/wbbasket\.ru/);
    expect(first!.imageUrl).toContain('501001');
    expect(first!.imageUrlAlternatives?.length).toBeGreaterThan(0);
    expect(first!.imageUrlAlternatives!.every((u) => u !== first!.imageUrl)).toBe(true);

    const result = pickSearchFromCandidates('wildberries', 'Redmi 15', REFERENCE, candidates, {
      referencePrice: 15_990,
    });
    const pool = result.offer.searchCandidates?.length
      ? result.offer.searchCandidates
      : result.offer.found && result.offer.imageUrl
        ? [{ imageUrl: result.offer.imageUrl, imageUrlAlternatives: undefined as string[] | undefined }]
        : [];
    expect(pool.length).toBeGreaterThan(0);
    for (const c of pool) {
      expect(c.imageUrl).toBeTruthy();
      expect(c.imageUrl).toMatch(/wbbasket\.ru/);
    }
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

    // Soft color: same model/storage may auto-verify; otherwise picker pool
    if (result.offer.found && result.offer.matchStatus === 'verified') {
      expect(result.offer.url).toContain('/catalog/');
      expect(result.offer.title).toMatch(/redmi\s*15/i);
    } else {
      expect(result.offer.searchCandidates?.length).toBeGreaterThan(0);
      expect(result.offer.searchCandidates!.length).toBeLessThanOrEqual(3);
      expect(
        result.offer.needsManualPick ||
          (result.offer.matchConfidence != null &&
            result.offer.matchConfidence < AUTO_PICK_CONFIDENCE_THRESHOLD),
      ).toBe(true);
    }
  });

  it('однозначный 8/256 чёрный → verified карточка; иначе пул needs_choice (не search found:true без URL)', () => {
    const candidates = parseWildberriesSerpHtml(wbSerpHtml, 'Redmi 15');
    const result = pickSearchFromCandidates('wildberries', 'Redmi 15 8/256', REFERENCE, candidates, {
      referencePrice: 15_990,
    });

    if (result.offer.found) {
      expect(result.offer.needsManualPick).toBe(false);
      expect(result.offer.matchStatus).toBe('verified');
      expect(result.offer.url).toContain('501001');
      expect(result.offer.price).toBe(15_990);
    } else {
      expect(result.offer.needsManualPick).toBe(true);
      expect(result.offer.matchStatus).toBe('needs_choice');
      expect(result.offer.url).toMatch(/\/search/i);
      expect(result.offer.url).not.toContain('501001');
      expect(result.offer.price).toBeNull();
    }
    expect(result.offer.matchConfidence).toBeGreaterThanOrEqual(AUTO_PICK_CONFIDENCE_THRESHOLD);
  });

  it('извлекает память и цвет из эталона', () => {
    const attrs = extractVariantAttributes(REFERENCE);
    expect(attrs.storage).toBe('8+256');
    expect(attrs.color).toBe('black');
  });

  it('плитки с низким score всё равно дают needs_choice, не not_found', () => {
    const candidates: SearchCandidate[] = [
      {
        title: 'Смартфон Nokia 3310 Dual SIM серый',
        url: 'https://www.wildberries.ru/catalog/777001/detail.aspx',
        price: 2990,
        rating: 4.1,
      },
      {
        title: 'Смартфон INOI A62 2/32GB черный',
        url: 'https://www.wildberries.ru/catalog/777002/detail.aspx',
        price: 4990,
        rating: 4.0,
      },
    ];
    const result = pickSearchFromCandidates(
      'wildberries',
      'Google Pixel 8',
      'Смартфон Google Pixel 8 8/128Gb светло-желтый',
      candidates,
      { referencePrice: 45_000 },
    );
    expect(result.offer.matchStatus).toBe('needs_choice');
    expect(result.offer.needsManualPick).toBe(true);
    expect(result.offer.searchCandidates?.length).toBeGreaterThan(0);
  });
});
