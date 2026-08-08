/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  reviewSectionAnchorSelectors,
  scrapeReviews,
  scrollToReviewsSection,
} from '@/utils/parsers/reviews';

describe('review section scroll guards', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('uses narrow anchors (no broad feedback/product-tabs roots)', () => {
    const anchors = reviewSectionAnchorSelectors();
    expect(anchors.some((s) => s.includes('class*="feedback"'))).toBe(false);
    expect(anchors).not.toContain('[data-auto="product-tabs"]');
    expect(anchors).toContain('[data-zone-name="reviews"]');
    expect(anchors).toContain('[data-widget="webListReviews"]');
  });

  it.each(['yandex_market', 'ozon', 'wildberries'] as const)(
    'allowNavigation=false does not scroll/click on %s',
    async (marketplace) => {
      document.body.innerHTML = `
        <div data-zone-name="reviews" id="reviews-anchor">reviews block</div>
        <button data-auto="tab-reviews">Отзывы</button>
        <a data-link="feedbacks" href="/feedbacks">feedbacks</a>
        <div data-widget="webReviewTabs"><button>Отзывы</button></div>
        <div data-auto="review-text">${'x'.repeat(40)} decent review text here</div>
      `;

      const anchor = document.getElementById('reviews-anchor')!;
      const scrollSpy = vi.fn();
      anchor.scrollIntoView = scrollSpy;

      const clickSpy = vi.fn();
      document.querySelectorAll('button, a').forEach((el) => {
        el.addEventListener('click', clickSpy);
      });

      const hrefBefore = window.location.href;
      const resultPromise = scrapeReviews(marketplace, 'all', { allowNavigation: false });
      await vi.runAllTimersAsync();
      await resultPromise;

      expect(scrollSpy).not.toHaveBeenCalled();
      expect(clickSpy).not.toHaveBeenCalled();
      expect(window.location.href).toBe(hrefBefore);
    },
  );

  it('scrollToReviewsSection scrolls the first narrow anchor once', () => {
    document.body.innerHTML = `
      <div class="feedback-badge">noise</div>
      <div data-auto="product-tabs">tabs</div>
      <div data-zone-name="reviews" id="ok">reviews</div>
    `;
    const ok = document.getElementById('ok')!;
    const scrollSpy = vi.fn();
    ok.scrollIntoView = scrollSpy;
    scrollToReviewsSection();
    expect(scrollSpy).toHaveBeenCalledTimes(1);
  });
});
