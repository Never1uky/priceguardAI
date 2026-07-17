import { describe, expect, it } from 'vitest';
import {
  buildFullAnalysisUserPrompt,
  buildWebResearchUserPrompt,
} from '@/lib/ai/prompts';

describe('web research + full analysis prompts', () => {
  it('includes web research block when provided', () => {
    const prompt = buildFullAnalysisUserPrompt({
      productTitle: 'Redmi 15',
      productPrice: 15_990,
      marketplace: 'wildberries',
      article: '501001',
      reviews: ['Отличный телефон', 'Камера хорошая', 'Батарея держит', 'Быстрый', 'Рекомендую'],
      webResearch: 'В обзорах хвалят батарею, критикуют камеру при слабом свете.',
    });

    expect(prompt).toContain('Данные из интернета (Perplexity Sonar)');
    expect(prompt).toContain('батарею');
    expect(prompt).toContain('Отзыв 1');
  });

  it('builds compact web research query', () => {
    const prompt = buildWebResearchUserPrompt({
      productTitle: 'Apple AirPods Pro 2',
      article: '123',
      marketplace: 'ozon',
      productPrice: 18_990,
    });

    expect(prompt).toContain('AirPods Pro 2');
    expect(prompt).toContain('обзоры');
  });
});
