import { describe, expect, it } from 'vitest';
import { parseWbFeedbackEntry, parseWbFeedbacksPayload } from '@/lib/reviews/wb-feedbacks';
import { normalizeAiResponse } from '@/lib/ai/local-fallback';

describe('parseWbFeedbackEntry', () => {
  it('combines text, pros and cons', () => {
    const item = parseWbFeedbackEntry({
      text: 'Отличные наушники',
      pros: 'Звук чистый',
      cons: 'Тяжёлые',
      productValuation: 5,
      photo: [1],
      createdDate: '2024-08-23T14:33:10Z',
    });

    expect(item?.text).toContain('Отличные наушники');
    expect(item?.text).toContain('Звук чистый');
    expect(item?.rating).toBe(5);
    expect(item?.hasPhoto).toBe(true);
    expect(item?.timestamp).toBeGreaterThan(0);
  });

  it('returns null for empty entry', () => {
    expect(parseWbFeedbackEntry({})).toBeNull();
  });
});

describe('parseWbFeedbacksPayload', () => {
  it('reads feedbacks array from v2 response', () => {
    const items = parseWbFeedbacksPayload({
      feedbacks: [
        { text: 'Хороший товар, рекомендую всем покупателям', productValuation: 5 },
        { text: 'Брак в упаковке', productValuation: 2 },
      ],
    });

    expect(items).toHaveLength(2);
    expect(items[0].rating).toBe(5);
  });

  it('reads nested feedbacksData', () => {
    const items = parseWbFeedbacksPayload({
      feedbacksData: {
        feedbacks: [{ text: 'Нормальный товар за свои деньги', productValuation: 4 }],
      },
    });

    expect(items).toHaveLength(1);
  });
});

describe('normalizeAiResponse', () => {
  it('maps AI JSON to ReviewAnalysisResult', () => {
    const result = normalizeAiResponse(
      {
        overallRating: 4.2,
        pros: ['Качество', 'Доставка'],
        cons: ['Цена'],
        fakeRisk: 'low',
        fakeRiskExplanation: 'Разнообразные отзывы',
        verdict: 'buy_now',
        summary: 'Товар хороший. Покупатели довольны. Рекомендуем к покупке.',
      },
      10,
      'Claude Sonnet',
      'claude',
      120,
    );

    expect(result.overallRating).toBe(4.2);
    expect(result.pros).toHaveLength(2);
    expect(result.fakeRisk).toBe('low');
    expect(result.verdict).toBe('buy_now');
    expect(result.reviewsAnalyzed).toBe(10);
    expect(result.totalReviewsFound).toBe(120);
  });
});
