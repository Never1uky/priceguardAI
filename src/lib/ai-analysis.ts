import {
  getProviderLabel,
  isCloudAiAvailable,
  parseAiJson,
  sendToAIWithFallback,
} from '@/api/ai';
import { ApiError } from '@/api/errors';
import { analyzeReviewsLocally, normalizeAiResponse } from '@/lib/ai/local-fallback';
import {
  REVIEW_ANALYSIS_SYSTEM_PROMPT,
  buildReviewAnalysisUserPrompt,
} from '@/lib/ai/prompts';
import { AI_REQUEST_DEFAULTS, validateReviewAnalysisJson } from '@/lib/ai/schemas';
import { isPremium } from '@/lib/subscription';
import type {
  ReviewAnalysisInput,
  ReviewAnalysisResult,
} from '@/types/review-analysis';

async function analyzeReviewsViaCloud(input: ReviewAnalysisInput): Promise<ReviewAnalysisResult> {
  const { text, providerUsed } = await sendToAIWithFallback(
    REVIEW_ANALYSIS_SYSTEM_PROMPT,
    buildReviewAnalysisUserPrompt(input),
    { ...AI_REQUEST_DEFAULTS, maxTokens: 700 },
  );

  try {
    const raw = parseAiJson<unknown>(text, getProviderLabel(providerUsed));
    const validated = validateReviewAnalysisJson(raw);
    return normalizeAiResponse(
      validated,
      input.reviews.length,
      getProviderLabel(providerUsed),
      providerUsed,
      input.totalReviewsFound,
    );
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError({
      code: 'parse_error',
      provider: 'AI',
      retryable: true,
      userMessage: 'AI вернул некорректный JSON. Повторите анализ.',
    });
  }
}

export async function analyzeReviewTexts(input: ReviewAnalysisInput): Promise<ReviewAnalysisResult> {
  return analyzeReviewsLocally(input);
}

export async function analyzeReviews(
  reviews: string[],
  productTitle: string,
  options?: {
    productPrice?: number;
    marketplace?: string;
    totalReviewsFound?: number;
    reviewRatings?: Array<number | undefined>;
    useCloud?: boolean;
  },
): Promise<ReviewAnalysisResult> {
  const input: ReviewAnalysisInput = {
    reviews,
    productTitle,
    productPrice: options?.productPrice,
    marketplace: options?.marketplace,
    totalReviewsFound: options?.totalReviewsFound,
    reviewRatings: options?.reviewRatings,
  };

  if (reviews.length < 5) {
    return analyzeReviewsLocally(input);
  }

  const tryCloud =
    options?.useCloud !== false && isCloudAiAvailable() && (await isPremium());

  if (tryCloud) {
    try {
      return await analyzeReviewsViaCloud(input);
    } catch (error) {
      console.warn('[PriceGuard] Cloud review analysis failed, using local:', error);
    }
  }

  return analyzeReviewsLocally(input);
}

export type { ReviewAnalysisResult };
