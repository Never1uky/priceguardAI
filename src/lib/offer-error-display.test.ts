import { describe, expect, it } from 'vitest';
import { formatOfferErrorForDisplay } from '@/lib/offer-error-display';

describe('formatOfferErrorForDisplay', () => {
  it('does not map 5xx + marketplace name to rate-limit copy', () => {
    const formatted = formatOfferErrorForDisplay(
      'Яндекс.Маркет: ошибка API (502). Площадка временно недоступна — укажите ссылку вручную',
    );
    expect(formatted.text).not.toMatch(/лимита запросов/);
  });

  it('maps real 429 / quota text to rate-limit copy', () => {
    const formatted = formatOfferErrorForDisplay(
      'Wildberries временно недоступен из‑за лимита запросов. Попробуйте позже.',
    );
    expect(formatted.text).toMatch(/лимита запросов/);
    expect(formatted.text).toMatch(/Wildberries/);
  });

  it('maps not-found-in-SERP to honest copy without similar-variants tease', () => {
    const formatted = formatOfferErrorForDisplay(
      'Подходящий товар не найден в выдаче (запрос: «AirPods»)',
    );
    expect(formatted.text).not.toMatch(/похожие вариант/i);
    expect(formatted.kind).toBe('no_confident_match');
  });
});
