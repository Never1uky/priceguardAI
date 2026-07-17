import type { FakeRiskLevel, PurchaseVerdict } from '@/types/review-analysis';
import type { AiProvider } from '@/types/review-analysis';

export interface AnalysisAlternative {
  name: string;
  reason: string;
}

/** Источник из Perplexity Sonar (url_citation) */
export interface WebResearchSource {
  title: string;
  url: string;
}

/** Версия контракта structured analysis (инвалидация при breaking change) */
export const FULL_ANALYSIS_SCHEMA_VERSION = 2;

/** Результат полного AI-анализа товара */
export interface FullProductAnalysis {
  qualityScore: number;
  qualitySummary: string;
  /** Краткий обзор товара (модель / категория) */
  webOverview: string;
  /** Ссылки на источники Sonar (Premium pipeline) */
  webSources?: WebResearchSource[];
  pros: string[];
  cons: string[];
  fakeRisk: FakeRiskLevel;
  fakeRiskExplanation: string;
  analogComparison: string;
  alternatives: AnalysisAlternative[];
  verdict: PurchaseVerdict;
  verdictExplanation: string;
  keySpecs: string[];
  hiddenProblems: string[];
  /** Динамический overlay — может пересчитываться без AI */
  priceInsight: string;
  source: AiProvider | 'local';
  providerLabel: string;
  analyzedAt: number;
  schemaVersion?: number;
}

export interface FullAnalysisInput {
  productTitle: string;
  productPrice: number;
  oldPrice?: number;
  marketplace: string;
  article: string;
  /** ID товара на площадке — для кэша веб-исследования Sonar */
  productId?: string;
  /** Принудительно обновить веб-исследование (игнорировать 7-дневный кэш) */
  forceRefreshWeb?: boolean;
  reviews: string[];
  totalReviewsFound?: number;
  priceHistory?: Array<{ price: number; date: string }>;
  compareOffers?: Array<{
    marketplace: string;
    price: number | null;
    rating: number | null;
    title: string;
  }>;
}

export interface RawFullAnalysisResponse {
  qualityScore: number;
  qualitySummary: string;
  webOverview?: string;
  pros?: string[];
  cons?: string[];
  fakeRisk: FakeRiskLevel;
  fakeRiskExplanation: string;
  analogComparison: string;
  alternatives?: AnalysisAlternative[];
  verdict: PurchaseVerdict;
  verdictExplanation: string;
  keySpecs: string[];
  hiddenProblems: string[];
  priceInsight: string;
}
