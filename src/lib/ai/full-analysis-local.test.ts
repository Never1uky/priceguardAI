import { describe, expect, it } from 'vitest';
import { analyzeFullLocally, normalizeFullAnalysisResponse } from '@/lib/ai/full-analysis-local';

describe('normalizeFullAnalysisResponse', () => {
  it('нормализует pros/cons/alternatives/webOverview', () => {
    const result = normalizeFullAnalysisResponse({
      qualityScore: 8,
      qualitySummary: 'Хороший товар',
      webOverview: 'Подходит для ежедневного использования',
      pros: ['Звук', 'Батарея'],
      cons: ['Цена'],
      fakeRisk: 'low',
      fakeRiskExplanation: 'Отзывы разнообразные',
      analogComparison: 'Лучше конкурентов в цене',
      alternatives: [{ name: 'Samsung Buds 3', reason: 'Дешевле на 20%' }],
      verdict: 'buy_now',
      verdictExplanation: 'Рекомендую к покупке',
      keySpecs: ['ANC'],
      hiddenProblems: [],
      priceInsight: 'Цена адекватная',
    });

    expect(result.pros).toEqual(['Звук', 'Батарея']);
    expect(result.cons).toEqual(['Цена']);
    expect(result.webOverview).toContain('ежедневного');
    expect(result.alternatives).toHaveLength(1);
    expect(result.verdict).toBe('buy_now');
  });
});

describe('analyzeFullLocally', () => {
  it('возвращает локальный анализ с альтернативами из compareOffers', () => {
    const result = analyzeFullLocally({
      productTitle: 'Наушники Test Pro',
      productPrice: 10_000,
      marketplace: 'wildberries',
      article: '123',
      reviews: [
        'Отличный звук, рекомендую покупать всем',
        'Качество на высоте, доставка быстрая',
        'Удобные, батарея держит долго',
        'Немного дорого, но стоит своих денег',
        'Супер товар, всем советую',
      ],
      compareOffers: [
        { marketplace: 'ozon', price: 9_500, rating: 4.8, title: 'Наушники Test Lite' },
      ],
    });

    expect(result.source).toBe('local');
    expect(result.verdict).toBeTruthy();
    expect(result.pros.length).toBeGreaterThan(0);
  });
});
