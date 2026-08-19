import { describe, expect, it } from 'vitest';
import {
  FEEDBACK_NEGATIVE_BIAS_CAP,
  FEEDBACK_POSITIVE_BIAS_CAP,
  computeFeedbackScoreBias,
} from '@/lib/mapping-demotion-policy';
import { pickTopMatchesWithScore, scoreProductMatch } from '@/lib/product-match';

describe('feedback bias policy', () => {
  it('caps accept/reject bias deltas and supports blocking recent rejects', () => {
    const pos = computeFeedbackScoreBias({ accepts: 10, rejects: 0 });
    expect(pos.delta).toBeLessThanOrEqual(FEEDBACK_POSITIVE_BIAS_CAP);
    expect(pos.delta).toBeGreaterThan(0);
    expect(pos.blocked).toBe(false);

    const neg = computeFeedbackScoreBias({ accepts: 0, rejects: 10 });
    expect(neg.delta).toBeGreaterThanOrEqual(-FEEDBACK_NEGATIVE_BIAS_CAP);
    expect(neg.delta).toBeLessThan(0);

    const blocked = computeFeedbackScoreBias({ accepts: 3, rejects: 1, rejectsRecent: 1 });
    expect(blocked.blocked).toBe(true);
    expect(blocked.delta).toBe(-FEEDBACK_NEGATIVE_BIAS_CAP);
  });

  it('feedback bias affects ranking only when feature flag is enabled', () => {
    const reference = 'Sony PlayStation 5';
    const candidates = [
      { title: 'Sony PlayStation 5', url: 'https://www.ozon.ru/product/a/' },
      { title: 'Sony PlayStation 5', url: 'https://www.ozon.ru/product/b/' },
    ];
    const baseline = pickTopMatchesWithScore(reference, candidates, (c) => c.title, {
      getUrl: (c) => c.url,
      minScore: 0.3,
      limit: 2,
    });
    const biased = pickTopMatchesWithScore(reference, candidates, (c) => c.title, {
      getUrl: (c) => c.url,
      minScore: 0.3,
      limit: 2,
      featureFlags: { enableFeedbackBias: true },
      feedbackBiasByUrl: new Map([
        ['https://www.ozon.ru/product/a/', -0.04],
        ['https://www.ozon.ru/product/b/', 0.06],
      ]),
    });
    expect(baseline[0]?.item.url).toBe('https://www.ozon.ru/product/a/');
    expect(biased[0]?.item.url).toBe('https://www.ozon.ru/product/b/');
  });

  it('feedback bias cannot bypass hard gates', () => {
    const hardMismatch = scoreProductMatch(
      'Apple AirPods Pro 2 USB-C',
      'Apple AirPods Pro 2 Lightning',
      undefined,
      'headphones',
    );
    expect(hardMismatch).toBe(0);
  });
});
