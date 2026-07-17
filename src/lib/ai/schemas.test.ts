import { describe, expect, it } from 'vitest';
import {
  validateFullAnalysisJson,
  validateReviewAnalysisJson,
  AI_REQUEST_DEFAULTS,
} from '@/lib/ai/schemas';

describe('AI_REQUEST_DEFAULTS', () => {
  it('uses jsonMode and low temperature', () => {
    expect(AI_REQUEST_DEFAULTS.jsonMode).toBe(true);
    expect(AI_REQUEST_DEFAULTS.temperature).toBe(0.2);
  });
});

describe('validateFullAnalysisJson', () => {
  it('accepts valid payload', () => {
    const result = validateFullAnalysisJson({
      qualityScore: 8,
      qualitySummary: 'Хороший товар по отзывам',
      webOverview: 'Подходит для ежедневного использования',
      pros: ['Звук'],
      cons: ['Цена'],
      fakeRisk: 'low',
      fakeRiskExplanation: 'Отзывы разнообразные',
      analogComparison: 'На уровне конкурентов',
      alternatives: [{ name: 'Buds 3', reason: 'Дешевле' }],
      verdict: 'buy_now',
      verdictExplanation: 'Рекомендую к покупке',
      keySpecs: ['ANC'],
      hiddenProblems: [],
      priceInsight: 'Цена адекватная',
    });
    expect(result.verdict).toBe('buy_now');
    expect(result.alternatives).toHaveLength(1);
  });

  it('rejects invalid verdict', () => {
    expect(() =>
      validateFullAnalysisJson({
        qualityScore: 5,
        qualitySummary: 'x',
        fakeRisk: 'low',
        verdict: 'maybe',
        verdictExplanation: 'x',
      }),
    ).toThrow();
  });
});

describe('validateReviewAnalysisJson', () => {
  it('accepts valid review analysis', () => {
    const result = validateReviewAnalysisJson({
      overallRating: 4.2,
      pros: ['Качество'],
      cons: ['Дорого'],
      fakeRisk: 'medium',
      fakeRiskExplanation: 'Шаблонные фразы',
      verdict: 'wait_discount',
      summary: 'Стоит подождать скидки',
    });
    expect(result.overallRating).toBe(4.2);
  });
});
