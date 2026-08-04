/**
 * AI full-analysis cache knobs — single place to tune reuse vs regenerate.
 * Edge Deno TTLs (product-cache-store) should stay in sync manually.
 */

import type { MappingEvidence } from '@/lib/cross-market-map';

export type AiCacheReason =
  | 'LOCAL_CACHE'
  | 'REMOTE_CACHE'
  | 'SAME_SKU'
  | 'CROSS_MARKETPLACE'
  | 'REVIEWS_MATCH'
  | 'SOFT_REFRESH'
  | 'NEW_ANALYSIS';

/** Feature weights for AI cache confidence (sum = 100). */
export const AI_CACHE_FEATURE_WEIGHTS = {
  brand: 30,
  model: 30,
  article: 15,
  storage: 10,
  color: 5,
  category: 10,
} as const;

export type AiCacheFeatureKey = keyof typeof AI_CACHE_FEATURE_WEIGHTS;

export const AI_CACHE_CONFIG = {
  /** Local chrome.storage full-analysis TTL */
  localTtlMs: 7 * 24 * 60 * 60 * 1000,
  /** Shared product_cache v2 TTL (client freshness check) */
  remoteTtlMs: 7 * 24 * 60 * 60 * 1000,
  /** Shared product_cache v3 web-research TTL */
  webResearchTtlMs: 14 * 24 * 60 * 60 * 1000,

  /** Invalidate when price moved by this fraction OR abs rub */
  priceDeltaPct: 0.1,
  priceDeltaAbs: 500,

  featureWeights: AI_CACHE_FEATURE_WEIGHTS,

  /** Min feature confidence (0–100) to reuse non-soft cache */
  reuseMinConfidence: 80,
  /** Softer bar for soft price overlay reuse */
  softRefreshMinConfidence: 70,

  /**
   * Hard reject when brand present on both sides and conflicts,
   * or categories incompatible — score forced below this.
   */
  hardRejectScore: 20,

  /** Storage/color both present and mismatch → cap score at this */
  variantMismatchScoreCap: 55,

  crossMpEnabled: true,
  /** Auto mapping must be at least this confident */
  crossMpMappingMinConfidence: 85,
  /** Always allow these evidence types when status=active */
  crossMpAllowedEvidence: ['manual', 'multi_user'] as MappingEvidence[],
  /** Allow evidence=auto when mapping.confidence >= crossMpMappingMinConfidence */
  crossMpAllowHighAuto: true,

  /**
   * Early product-intel lookup without reviews (same marketplace SKU only).
   * Cross-MP still requires mapping gate + feature confidence.
   */
  allowRemoteLookupWithoutReviews: true,
} as const;

export type AiCacheConfig = typeof AI_CACHE_CONFIG;
