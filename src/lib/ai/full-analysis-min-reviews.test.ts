import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ApiError } from '@/api/errors';
import type { FullAnalysisInput } from '@/types/full-analysis';

vi.mock('@/lib/subscription', () => ({
  isPremium: vi.fn(),
}));

vi.mock('@/lib/ai/full-analysis-cloud', () => ({
  canUseCloudFullAnalysis: () => false,
  analyzeFullViaCloud: vi.fn(),
}));

import { isPremium } from '@/lib/subscription';
import { runFullProductAnalysis } from '@/lib/ai/full-analysis';

const baseInput: FullAnalysisInput = {
  productTitle: 'Test product',
  productPrice: 1000,
  marketplace: 'wildberries',
  article: '123',
  reviews: [],
};

describe('runFullProductAnalysis min reviews', () => {
  beforeEach(() => {
    vi.mocked(isPremium).mockReset();
  });

  it('Free blocks at 4 reviews', async () => {
    vi.mocked(isPremium).mockResolvedValue(false);
    await expect(
      runFullProductAnalysis({ ...baseInput, reviews: ['a', 'b', 'c', 'd'] }),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it('Premium allows 0 reviews', async () => {
    vi.mocked(isPremium).mockResolvedValue(true);
    const result = await runFullProductAnalysis({ ...baseInput, reviews: [] });
    expect(result.source).toBe('local');
  });
});
