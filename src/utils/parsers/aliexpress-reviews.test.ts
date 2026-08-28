/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { scrapeReviews } from '@/utils/parsers/reviews';
import { getMarketplaceEntry } from '@/lib/marketplaces/registry';
import { targetFromUrl } from '@/lib/reviews/resolve-target';

describe('AliExpress reviews (tab DOM)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('capabilities.reviews is true — live DOM path proven', () => {
    expect(getMarketplaceEntry('aliexpress')?.capabilities.reviews).toBe(true);
  });

  it('resolveReviewTarget accepts Ali item URL', () => {
    const t = targetFromUrl('https://aliexpress.ru/item/1005006524571627.html?spm=x');
    expect(t.marketplace).toBe('aliexpress');
    expect(t.productUrl).toContain('/item/1005006524571627.html');
  });

  it('resolveReviewTarget rejects Mega (reviews still SKIP)', () => {
    expect(() =>
      targetFromUrl('https://megamarket.ru/catalog/details/smartfon-100067205836/'),
    ).toThrow(/недоступны/i);
  });

  it('scrapes ≥3 real-length texts from RedReviews clamped nodes (passive)', async () => {
    document.body.innerHTML = `
      <ul class="RedReviewsProductFeedbackList_ReviewListMini__list__x">
        <li>
          <span class="RedReviewsProductFeedbackList_ReviewContent__clampedText__1jf3z">
            Заказ пришел, полностью соответствует описанию. русский язык имеется. упаковка отличная.
          </span>
        </li>
        <li>
          <span class="RedReviewsProductFeedbackList_ReviewContent__clampedText__1jf3z">
            про сам телефон думаю писать не надо, но продавец и доставка заслуживают отдельного отзыва.
          </span>
        </li>
        <li>
          <span class="RedReviewsProductFeedbackList_ReviewContent__clampedText__1jf3z">
            Доставка до Москвы 19 дней после оплаты. Товар хорошо упакован и прибыл без повреждений.
          </span>
        </li>
        <li>
          <span class="RedReviewsProductFeedbackList_ReviewContent__clampedText__1jf3z">
            Заказывал за 67к, посылка дошла, всё работает, рекомендую этот лот и продавца.
          </span>
        </li>
      </ul>
    `;

    const resultPromise = scrapeReviews('aliexpress', 'all', { allowNavigation: false });
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.totalFound).toBeGreaterThanOrEqual(3);
    expect(result.reviews.length).toBeGreaterThanOrEqual(3);
    expect(result.reviews[0]!.text.length).toBeGreaterThanOrEqual(40);
  });

  it('allowNavigation=false does not click Ali /reviews link', async () => {
    document.body.innerHTML = `
      <a href="https://aliexpress.ru/item/1/reviews">Все отзывы</a>
      <span class="RedReviewsProductFeedbackList_ReviewContent__clampedText__x">
        ${'Отличный телефон, всё соответствует описанию продавца. '.repeat(2)}
      </span>
    `;
    const clickSpy = vi.fn();
    document.querySelector('a')!.addEventListener('click', clickSpy);

    const resultPromise = scrapeReviews('aliexpress', 'all', { allowNavigation: false });
    await vi.runAllTimersAsync();
    await resultPromise;

    expect(clickSpy).not.toHaveBeenCalled();
  });
});
