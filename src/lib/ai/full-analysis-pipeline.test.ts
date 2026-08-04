import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ApiError } from '@/api/errors';
import type { FullAnalysisInput } from '@/types/full-analysis';

vi.mock('@/lib/subscription', () => ({
  isPremium: vi.fn(),
}));

vi.mock('@/lib/ai/full-analysis-cloud', () => ({
  canUseCloudFullAnalysis: vi.fn(),
  analyzeFullViaCloud: vi.fn(),
}));

import { isPremium } from '@/lib/subscription';
import { analyzeFullViaCloud, canUseCloudFullAnalysis } from '@/lib/ai/full-analysis-cloud';
import { runFullProductAnalysis } from '@/lib/ai/full-analysis';

const baseInput: FullAnalysisInput = {
  productTitle: 'Test product',
  productPrice: 1000,
  marketplace: 'wildberries',
  article: '123',
  reviews: ['r1', 'r2', 'r3', 'r4', 'r5'],
};

describe('runFullProductAnalysis pipeline', () => {
  beforeEach(() => {
    vi.mocked(isPremium).mockReset();
    vi.mocked(analyzeFullViaCloud).mockReset();
    vi.mocked(canUseCloudFullAnalysis).mockReset();
    vi.mocked(canUseCloudFullAnalysis).mockReturnValue(true);
    vi.mocked(isPremium).mockResolvedValue(true);
    vi.mocked(analyzeFullViaCloud).mockResolvedValue({
      qualityScore: 7,
      qualitySummary: 'ok',
      webOverview: '',
      pros: [],
      cons: [],
      fakeRisk: 'low',
      fakeRiskExplanation: '',
      analogComparison: '',
      alternatives: [],
      verdict: 'buy_now',
      verdictExplanation: '',
      keySpecs: [],
      hiddenProblems: [],
      priceInsight: '',
      source: 'grok',
      providerLabel: 'Grok',
      analyzedAt: Date.now(),
      schemaVersion: 1,
    } as never);
  });

  it('default Run is lite (no webResearch)', async () => {
    await runFullProductAnalysis(baseInput);
    expect(analyzeFullViaCloud).toHaveBeenCalledWith(
      expect.objectContaining({ productTitle: 'Test product' }),
      { webResearch: false },
    );
  });

  it('webResearch: true requests Sonar pipeline', async () => {
    await runFullProductAnalysis(baseInput, { webResearch: true });
    expect(analyzeFullViaCloud).toHaveBeenCalledWith(
      expect.any(Object),
      { webResearch: true },
    );
  });

  it('Premium without webResearch still lite', async () => {
    vi.mocked(isPremium).mockResolvedValue(true);
    await runFullProductAnalysis(baseInput, { webResearch: false });
    expect(analyzeFullViaCloud).toHaveBeenCalledWith(expect.any(Object), {
      webResearch: false,
    });
  });

  it('Free blocks at 4 reviews', async () => {
    vi.mocked(isPremium).mockResolvedValue(false);
    vi.mocked(canUseCloudFullAnalysis).mockReturnValue(false);
    await expect(
      runFullProductAnalysis({ ...baseInput, reviews: ['a', 'b', 'c', 'd'] }),
    ).rejects.toBeInstanceOf(ApiError);
  });
});
