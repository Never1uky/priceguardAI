import { describe, expect, it } from 'vitest';
import { buildFullAnalysisUserPrompt } from '@/lib/ai/prompts';

describe('buildFullAnalysisUserPrompt web-only', () => {
  it('0 reviews + webResearch → Sonar instructions, no empty reviews block', () => {
    const prompt = buildFullAnalysisUserPrompt({
      productTitle: 'Новинка',
      productPrice: 5000,
      marketplace: 'ozon',
      article: '999',
      reviews: [],
      webResearch: 'Обзоры в сети положительные.',
    });
    expect(prompt).toContain('нет отзывов');
    expect(prompt).toContain('Sonar');
    expect(prompt).not.toContain('--- Отзыв 1 ---');
  });
});
