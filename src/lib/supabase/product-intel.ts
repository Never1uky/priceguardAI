/**
 * Клиент Edge product-intel — общий pipeline с Telegram.
 */

import { callEdgeSafe } from '@/lib/supabase/edge';
import { isPremium } from '@/lib/subscription';
import type { Marketplace } from '@/types/product';
import type { FullProductAnalysis } from '@/types/full-analysis';
import { FULL_ANALYSIS_SCHEMA_VERSION } from '@/types/full-analysis';
import type { FakeRiskLevel, PurchaseVerdict } from '@/types/review-analysis';

export interface ProductIntelCardDto {
  marketplace: Marketplace;
  productId: string;
  productKey: string;
  url: string;
  title: string;
  price: number | null;
  rating: number | null;
  imageUrl: string | null;
  analysis: Partial<FullProductAnalysis> | null;
  fromCache: boolean;
  analysisStatus: 'ready' | 'missing' | 'insufficient_reviews' | 'error';
  analysisNote?: string;
  analyzedAt: number | null;
}

interface ProductIntelAnalyzeResponse {
  ok?: boolean;
  error?: string;
  card?: ProductIntelCardDto;
  [key: string]: unknown;
}

function asAnalysis(raw: Partial<FullProductAnalysis> | null | undefined): FullProductAnalysis | null {
  if (!raw || typeof raw.qualityScore !== 'number') return null;
  const fakeRisk = (['low', 'medium', 'high'].includes(String(raw.fakeRisk))
    ? raw.fakeRisk
    : 'medium') as FakeRiskLevel;
  const verdict = (['buy_now', 'wait_discount', 'not_recommended'].includes(String(raw.verdict))
    ? raw.verdict
    : 'wait_discount') as PurchaseVerdict;

  return {
    qualityScore: raw.qualityScore,
    qualitySummary: String(raw.qualitySummary ?? ''),
    webOverview: String(raw.webOverview ?? ''),
    webSources: raw.webSources,
    pros: Array.isArray(raw.pros) ? raw.pros.map(String) : [],
    cons: Array.isArray(raw.cons) ? raw.cons.map(String) : [],
    fakeRisk,
    fakeRiskExplanation: String(raw.fakeRiskExplanation ?? ''),
    analogComparison: String(raw.analogComparison ?? ''),
    alternatives: Array.isArray(raw.alternatives)
      ? raw.alternatives.map((a) => ({
          name: String(a?.name ?? ''),
          reason: String(a?.reason ?? ''),
        }))
      : [],
    verdict,
    verdictExplanation: String(raw.verdictExplanation ?? ''),
    keySpecs: Array.isArray(raw.keySpecs) ? raw.keySpecs.map(String) : [],
    hiddenProblems: Array.isArray(raw.hiddenProblems) ? raw.hiddenProblems.map(String) : [],
    priceInsight: String(raw.priceInsight ?? ''),
    source: (raw.source as FullProductAnalysis['source']) ?? 'grok',
    providerLabel: String(raw.providerLabel ?? 'PriceGuard AI'),
    analyzedAt: typeof raw.analyzedAt === 'number' ? raw.analyzedAt : Date.now(),
    schemaVersion: raw.schemaVersion ?? FULL_ANALYSIS_SCHEMA_VERSION,
  };
}

export async function analyzeViaProductIntel(params: {
  url: string;
  marketplace?: Marketplace;
  productId?: string;
  productUrl?: string;
  reviews?: string[];
  /** false = cache/lookup only, без генерации AI на Edge */
  allowGenerate?: boolean;
  forcePremium?: boolean;
  /** Явный action: 'lookup' = только кэш по marketplace+productId */
  action?: 'analyze' | 'lookup';
}): Promise<{
  card: ProductIntelCardDto;
  analysis: FullProductAnalysis | null;
} | null> {
  const premium = params.forcePremium ?? (await isPremium());
  const action = params.action ?? 'analyze';

  const body =
    action === 'lookup'
      ? {
          action: 'lookup' as const,
          marketplace: params.marketplace,
          productId: params.productId,
        }
      : {
          action: 'analyze' as const,
          url: params.url,
          marketplace: params.marketplace,
          productId: params.productId,
          productUrl: params.productUrl ?? params.url,
          reviews: params.reviews,
          allowGenerate: params.allowGenerate !== false,
          isPremium: premium,
        };

  const data = await callEdgeSafe<ProductIntelAnalyzeResponse>('product-intel', body);

  if (!data?.ok) return null;

  // lookup returns { analysis } without card wrapper sometimes
  if (action === 'lookup') {
    const analysis = asAnalysis(
      (data.analysis as Partial<FullProductAnalysis> | null | undefined) ??
        data.card?.analysis,
    );
    if (!analysis) return null;
    const card: ProductIntelCardDto = data.card ?? {
      marketplace: params.marketplace!,
      productId: String(params.productId ?? ''),
      productKey: `${params.marketplace}:${params.productId}`,
      url: params.productUrl ?? params.url,
      title: '',
      price: null,
      rating: null,
      imageUrl: null,
      analysis,
      fromCache: true,
      analysisStatus: 'ready',
      analyzedAt: analysis.analyzedAt,
    };
    return { card: { ...card, fromCache: true, analysisStatus: 'ready' }, analysis };
  }

  if (!data.card) return null;
  return {
    card: data.card,
    analysis: asAnalysis(data.card.analysis),
  };
}
