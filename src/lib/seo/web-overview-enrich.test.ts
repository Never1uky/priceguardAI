import { describe, expect, it } from 'vitest';
import { SEO_MIN_WEB_OVERVIEW_LEN, evaluateSeoPublishGates } from './publish-gates';
import {
  composeWebOverviewFromAnalysis,
  enrichAnalysisWebOverviewForSeo,
} from './web-overview-enrich';

const solidFields = {
  webOverview: '',
  qualitySummary: 'Звук чистый, автономность держит заявленное.',
  verdictExplanation: 'Можно брать на скидке, если микрофон не критичен.',
  priceInsight: 'Цена в рынке без явного демпинга.',
  pros: ['Звук', 'Автономность', 'Посадка'],
  cons: ['Микрофон на ветру'],
  keySpecs: ['BT 5.3', 'до 30 ч'],
};

describe('composeWebOverviewFromAnalysis', () => {
  it('keeps existing long webOverview unchanged', () => {
    const long = 'x'.repeat(SEO_MIN_WEB_OVERVIEW_LEN + 10);
    expect(
      composeWebOverviewFromAnalysis({ ...solidFields, webOverview: long }),
    ).toBe(long);
  });

  it('pads short/empty webOverview from analysis fields to ≥ SEO_MIN_WEB_OVERVIEW_LEN', () => {
    const text = composeWebOverviewFromAnalysis(solidFields, {
      categorySlug: 'headphones',
    });
    expect(text.length).toBeGreaterThanOrEqual(SEO_MIN_WEB_OVERVIEW_LEN);
    expect(text).toContain('Звук чистый');
    expect(text).toContain('Плюсы по данным анализа');
  });

  it('does not invent review quotes', () => {
    const text = composeWebOverviewFromAnalysis(solidFields);
    expect(text.toLowerCase()).not.toMatch(/купил на|зв[её]зд|отзыв №/);
  });

  it('thin analysis stays short enough that gates still reject', () => {
    const text = composeWebOverviewFromAnalysis({
      webOverview: '',
      qualitySummary: 'Мало данных.',
      verdictExplanation: '',
      pros: [],
      cons: [],
    });
    expect(text.length).toBeLessThan(SEO_MIN_WEB_OVERVIEW_LEN);
  });

  it('does not pad thin text with generic DEFAULT_AXES', () => {
    const text = composeWebOverviewFromAnalysis(
      { webOverview: '', qualitySummary: 'Мало данных.', pros: [], cons: [] },
      { categorySlug: null },
    );
    expect(text).toBe('Мало данных.');
    expect(text).not.toContain('При сравнении ориентируйтесь');
  });
});

describe('enrich → publish gates (Ali/Mega volume path)', () => {
  const gateBase = {
    qualityScore: 8,
    qualitySummary: solidFields.qualitySummary,
    verdictExplanation: solidFields.verdictExplanation,
    verdict: 'wait_discount',
    fakeRisk: 'low',
    source: 'openai',
    pros: solidFields.pros,
    cons: solidFields.cons,
  };

  it('reject: thin Ali/Mega analysis (empty webOverview, 0 reviews)', () => {
    expect(
      evaluateSeoPublishGates({
        analysis: { ...gateBase, webOverview: '' },
        reviewCount: 0,
        title: 'Смартфон Google Pixel 10 128GB',
      }).reason,
    ).toBe('insufficient_reviews');
  });

  it('pass: same analysis after compose webOverview (no fake reviewCount)', () => {
    const enriched = enrichAnalysisWebOverviewForSeo(
      { ...solidFields, webOverview: '' },
      { categorySlug: 'smartphones' },
    );
    expect(enriched.webOverview.length).toBeGreaterThanOrEqual(SEO_MIN_WEB_OVERVIEW_LEN);
    expect(
      evaluateSeoPublishGates({
        analysis: { ...gateBase, webOverview: enriched.webOverview },
        reviewCount: 0,
        title: 'Смартфон Google Pixel 10 128GB',
      }),
    ).toEqual({ ok: true });
  });

  it('still rejects local_source even with long webOverview', () => {
    const enriched = enrichAnalysisWebOverviewForSeo(solidFields);
    expect(
      evaluateSeoPublishGates({
        analysis: {
          ...gateBase,
          webOverview: enriched.webOverview,
          source: 'local',
        },
        reviewCount: 0,
      }).reason,
    ).toBe('local_source');
  });
});
