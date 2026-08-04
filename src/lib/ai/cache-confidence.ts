/**
 * Confidence-based AI cache reuse decisions.
 */

import {
  AI_CACHE_CONFIG,
  type AiCacheReason,
} from '@/lib/ai/cache-config';
import type { MappingEvidence } from '@/lib/cross-market-map';
import { areCategoriesIncompatible } from '@/lib/category-plugins';
import {
  extractProductFeatures,
  type ProductFeatures,
} from '@/lib/product-features';
import { areBrandsCompatible } from '@/lib/model-extract';
import { areModelsCompatible } from '@/lib/product-match';
import type { ProductCategory } from '@/lib/match-category';

export interface AiCacheConfidenceParts {
  brand: number | null;
  model: number | null;
  article: number | null;
  storage: number | null;
  color: number | null;
  category: number | null;
}

export interface AiCacheConfidenceResult {
  score: number;
  parts: AiCacheConfidenceParts;
  hardReject: boolean;
  reasonHints: string[];
}

export interface MappingGateInput {
  status?: string | null;
  evidence?: MappingEvidence | null;
  confidence?: number | null;
}

export interface DecideAiCacheReuseInput {
  forceRefresh?: boolean;
  softRefresh?: boolean;
  /** Deep Sonar path — caller should skip lite cross-MP; we still block soft-only logic */
  webResearch?: boolean;
  /** Same marketplace + product id */
  sameSku?: boolean;
  /** Reviews hash matches (when both sides have reviews) */
  reviewsHashMatch?: boolean;
  /** Feature confidence 0–100 */
  confidence: number;
  hardReject?: boolean;
  /** Cross-MP mapping candidate */
  mapping?: MappingGateInput | null;
  /** Significant price move vs cache */
  significantPriceChange?: boolean;
  /** Within TTL */
  fresh?: boolean;
}

export interface DecideAiCacheReuseResult {
  reuse: boolean;
  reason: AiCacheReason;
  score: number;
}

function norm(s: string | undefined): string {
  return (s ?? '').toLowerCase().replace(/\s+/g, '').replace(/[()]/g, '');
}

function brandFamily(brand: string | undefined): string | undefined {
  if (!brand) return undefined;
  const b = brand.toLowerCase();
  if (b === 'redmi' || b === 'poco' || b === 'xiaomi') return 'xiaomi';
  return b;
}

function partScore(match: boolean | 'unknown'): number | null {
  if (match === 'unknown') return null;
  return match ? 100 : 0;
}

/**
 * Weighted feature confidence 0–100 for AI cache reuse.
 * Missing features on either side are skipped (weights renormalized).
 */
export function computeAiCacheConfidence(
  current: ProductFeatures,
  cached: ProductFeatures,
  opts?: { article?: string; cachedArticle?: string },
): AiCacheConfidenceResult {
  const hints: string[] = [];
  const weights = AI_CACHE_CONFIG.featureWeights;

  const curCat =
    current.category ??
    (current.title ? extractProductFeatures(current.title).category : undefined);
  const cachedCat =
    cached.category ??
    (cached.title ? extractProductFeatures(cached.title).category : undefined);

  if (
    curCat &&
    cachedCat &&
    areCategoriesIncompatible(curCat as ProductCategory, cachedCat as ProductCategory)
  ) {
    return {
      score: AI_CACHE_CONFIG.hardRejectScore,
      parts: {
        brand: null,
        model: null,
        article: null,
        storage: null,
        color: null,
        category: 0,
      },
      hardReject: true,
      reasonHints: ['category_incompatible'],
    };
  }

  const refBrand = brandFamily(current.brand);
  const candBrand = brandFamily(cached.brand);
  let brandMatch: boolean | 'unknown' = 'unknown';
  if (refBrand && candBrand) {
    brandMatch =
      refBrand === candBrand ||
      areBrandsCompatible(current.title || '', cached.title || '');
    if (!brandMatch) {
      return {
        score: AI_CACHE_CONFIG.hardRejectScore,
        parts: {
          brand: 0,
          model: null,
          article: null,
          storage: null,
          color: null,
          category: null,
        },
        hardReject: true,
        reasonHints: ['brand_mismatch'],
      };
    }
  }

  let modelMatch: boolean | 'unknown' = 'unknown';
  if (current.model && cached.model) {
    const ok = areModelsCompatible(current.model, cached.model);
    modelMatch = ok;
    if (!ok) hints.push('model_mismatch');
  }

  const articleA = norm(opts?.article);
  const articleB = norm(opts?.cachedArticle);
  let articleMatch: boolean | 'unknown' = 'unknown';
  if (articleA && articleB) {
    articleMatch = articleA === articleB;
    if (!articleMatch) hints.push('article_mismatch');
  }

  let storageMatch: boolean | 'unknown' = 'unknown';
  if (current.storage && cached.storage) {
    storageMatch = norm(current.storage) === norm(cached.storage);
    if (!storageMatch) hints.push('storage_mismatch');
  }

  let colorMatch: boolean | 'unknown' = 'unknown';
  if (current.color && cached.color) {
    colorMatch = norm(current.color) === norm(cached.color);
    if (!colorMatch) hints.push('color_mismatch');
  }

  let categoryMatch: boolean | 'unknown' = 'unknown';
  if (curCat && cachedCat) {
    categoryMatch = curCat === cachedCat;
    if (!categoryMatch) hints.push('category_differ');
  }

  const parts: AiCacheConfidenceParts = {
    brand: partScore(brandMatch),
    model: partScore(modelMatch),
    article: partScore(articleMatch),
    storage: partScore(storageMatch),
    color: partScore(colorMatch),
    category: partScore(categoryMatch),
  };

  let weightSum = 0;
  let scored = 0;
  (Object.keys(weights) as Array<keyof typeof weights>).forEach((key) => {
    const p = parts[key];
    if (p == null) return;
    weightSum += weights[key];
    scored += (p / 100) * weights[key];
  });

  let score = weightSum > 0 ? Math.round((scored / weightSum) * 100) : 50;

  // Variant hard-ish cap: both storage present and differ
  if (storageMatch === false || colorMatch === false) {
    score = Math.min(score, AI_CACHE_CONFIG.variantMismatchScoreCap);
  }

  if (modelMatch === false) {
    score = Math.min(score, AI_CACHE_CONFIG.variantMismatchScoreCap);
  }

  return {
    score,
    parts,
    hardReject: false,
    reasonHints: hints,
  };
}

/** Build features from title (+ optional article for fingerprinting). */
export function featuresFromTitle(title: string, specs?: string): ProductFeatures {
  return extractProductFeatures(title, specs);
}

export function mappingAllowsCrossMpReuse(mapping: MappingGateInput | null | undefined): boolean {
  if (!AI_CACHE_CONFIG.crossMpEnabled) return false;
  if (!mapping) return false;
  if (mapping.status && mapping.status !== 'active') return false;

  const evidence = mapping.evidence ?? 'auto';
  const conf = mapping.confidence ?? 0;

  if (AI_CACHE_CONFIG.crossMpAllowedEvidence.includes(evidence)) {
    return true;
  }
  if (
    AI_CACHE_CONFIG.crossMpAllowHighAuto &&
    evidence === 'auto' &&
    conf >= AI_CACHE_CONFIG.crossMpMappingMinConfidence
  ) {
    return true;
  }
  return false;
}

/**
 * Central reuse decision. Caller supplies confidence + context flags.
 */
export function decideAiCacheReuse(input: DecideAiCacheReuseInput): DecideAiCacheReuseResult {
  const score = input.confidence;

  if (input.forceRefresh || input.webResearch) {
    // Deep / hard: never soft-serve lite cache here (caller skips lookup for deep).
    if (input.webResearch && !input.forceRefresh) {
      // webResearch without force still may reuse SAME_SKU deep cache — treat as miss for lite gates
      return { reuse: false, reason: 'NEW_ANALYSIS', score };
    }
    if (input.forceRefresh) {
      return { reuse: false, reason: 'NEW_ANALYSIS', score };
    }
  }

  if (input.fresh === false) {
    return { reuse: false, reason: 'NEW_ANALYSIS', score };
  }

  if (input.significantPriceChange && !input.softRefresh) {
    return { reuse: false, reason: 'NEW_ANALYSIS', score };
  }

  if (input.hardReject) {
    return { reuse: false, reason: 'NEW_ANALYSIS', score };
  }

  if (input.softRefresh) {
    const min = AI_CACHE_CONFIG.softRefreshMinConfidence;
    if (score >= min || input.sameSku) {
      return { reuse: true, reason: 'SOFT_REFRESH', score };
    }
    return { reuse: false, reason: 'NEW_ANALYSIS', score };
  }

  // Cross-MP path
  if (input.mapping && mappingAllowsCrossMpReuse(input.mapping)) {
    if (score >= AI_CACHE_CONFIG.reuseMinConfidence) {
      return { reuse: true, reason: 'CROSS_MARKETPLACE', score };
    }
    return { reuse: false, reason: 'NEW_ANALYSIS', score };
  }

  if (input.sameSku) {
    if (input.reviewsHashMatch) {
      return { reuse: true, reason: 'REVIEWS_MATCH', score: Math.max(score, 90) };
    }
    // Same SKU without review hash (early remote / soft features)
    if (
      AI_CACHE_CONFIG.allowRemoteLookupWithoutReviews ||
      score >= AI_CACHE_CONFIG.reuseMinConfidence
    ) {
      return { reuse: true, reason: 'SAME_SKU', score: Math.max(score, 85) };
    }
  }

  if (input.reviewsHashMatch && score >= AI_CACHE_CONFIG.reuseMinConfidence) {
    return { reuse: true, reason: 'REVIEWS_MATCH', score };
  }

  if (score >= AI_CACHE_CONFIG.reuseMinConfidence) {
    return { reuse: true, reason: 'LOCAL_CACHE', score };
  }

  return { reuse: false, reason: 'NEW_ANALYSIS', score };
}

/** Label which storage layer served the hit (orthogonal to decide reason). */
export function refineCacheReasonForSource(
  reason: AiCacheReason,
  source: 'local' | 'remote',
): AiCacheReason {
  if (reason === 'SAME_SKU' || reason === 'CROSS_MARKETPLACE' || reason === 'REVIEWS_MATCH') {
    return reason;
  }
  if (reason === 'SOFT_REFRESH') return reason;
  if (reason === 'NEW_ANALYSIS') return reason;
  return source === 'remote' ? 'REMOTE_CACHE' : 'LOCAL_CACHE';
}
