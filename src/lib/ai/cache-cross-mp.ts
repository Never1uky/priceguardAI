/**
 * Cross-marketplace AI cache lookup via cross_market_mapping.
 * Never calls Sonar — only reads existing product_cache / features gate.
 */

import { AI_CACHE_CONFIG } from '@/lib/ai/cache-config';
import {
  computeAiCacheConfidence,
  decideAiCacheReuse,
  featuresFromTitle,
  mappingAllowsCrossMpReuse,
  refineCacheReasonForSource,
} from '@/lib/ai/cache-confidence';
import type { AiCacheReason } from '@/lib/ai/cache-config';
import {
  lookupCrossMarketMappings,
  type CrossMarketMapping,
} from '@/lib/cross-market-map';
import { getRemoteFullProductCache } from '@/lib/supabase/product-cache';
import type { FullProductAnalysis } from '@/types/full-analysis';
import type { Marketplace } from '@/types/product';
import type { ComparisonMarketplace } from '@/types/comparison';
import { COMPARISON_MARKETPLACE_IDS } from '@/lib/marketplaces/registry';

const OTHER_MPS: ComparisonMarketplace[] = [...COMPARISON_MARKETPLACE_IDS];

export interface CrossMpCacheHit {
  analysis: FullProductAnalysis;
  cacheReason: AiCacheReason;
  cacheConfidence: number;
  mapping: CrossMarketMapping;
  sourceMarketplace: Marketplace;
  sourceProductId: string;
}

function asComparisonMp(mp: Marketplace): ComparisonMarketplace {
  return mp as ComparisonMarketplace;
}

/**
 * Find a reusable full analysis on a mapped marketplace SKU.
 */
export async function lookupCrossMarketplaceAiCache(params: {
  marketplace: Marketplace;
  productId: string;
  productTitle: string;
  article?: string;
}): Promise<CrossMpCacheHit | null> {
  if (!AI_CACHE_CONFIG.crossMpEnabled) return null;
  if (!params.productId) return null;

  const sourceMp = asComparisonMp(params.marketplace);
  const current = featuresFromTitle(params.productTitle);

  for (const targetMp of OTHER_MPS) {
    if (targetMp === sourceMp) continue;

    let mappings: CrossMarketMapping[] = [];
    try {
      mappings = await lookupCrossMarketMappings(sourceMp, params.productId, targetMp);
    } catch {
      continue;
    }

    for (const mapping of mappings) {
      if (!mappingAllowsCrossMpReuse(mapping)) continue;

      const remote = await getRemoteFullProductCache(
        targetMp as Marketplace,
        mapping.targetProductId,
      );
      if (!remote?.fresh || !remote.aiAnalysis) continue;

      const cachedTitle = remote.productTitle || params.productTitle;
      const cachedFeat = featuresFromTitle(cachedTitle);
      const conf = computeAiCacheConfidence(current, cachedFeat, {
        article: params.article,
        cachedArticle: mapping.targetProductId,
      });

      const decided = decideAiCacheReuse({
        sameSku: false,
        mapping: {
          status: mapping.status,
          evidence: mapping.evidence,
          confidence: mapping.confidence,
        },
        confidence: conf.score,
        hardReject: conf.hardReject,
        fresh: true,
        reviewsHashMatch: false,
      });

      if (!decided.reuse || decided.reason !== 'CROSS_MARKETPLACE') continue;

      return {
        analysis: remote.aiAnalysis,
        cacheReason: refineCacheReasonForSource('CROSS_MARKETPLACE', 'remote'),
        cacheConfidence: decided.score,
        mapping,
        sourceMarketplace: targetMp as Marketplace,
        sourceProductId: mapping.targetProductId,
      };
    }
  }

  return null;
}
