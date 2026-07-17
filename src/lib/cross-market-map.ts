/**
 * Клиент глобального кэша соответствий товаров между площадками (v2).
 * Lookup: primary + alternates (active only).
 * Upsert: primary + optional alternates.
 * Dispute / reportFail: anti-poisoning.
 */

import { callEdgeSafe } from '@/lib/supabase/edge';
import { AUTO_PICK_CONFIDENCE_THRESHOLD } from '@/lib/product-match';
import { buildWildberriesUrl } from '@/utils/marketplace';
import { toCanonicalProductUrl } from '@/utils/product-url';
import { extractComparisonArticle, normalizeCompareUrl } from '@/utils/comparison-url';
import type { ComparisonMarketplace } from '@/types/comparison';

export type MappingEvidence = 'auto' | 'manual' | 'multi_user';
export type MappingStatus = 'active' | 'disputed' | 'dead';

export interface CrossMarketMapping {
  sourceMarketplace: ComparisonMarketplace;
  sourceProductId: string;
  targetMarketplace: ComparisonMarketplace;
  targetProductId: string;
  targetUrl: string;
  confidence?: number;
  hits?: number;
  rank?: number;
  status?: MappingStatus;
  evidence?: MappingEvidence;
}

export interface MappingAlternate {
  targetProductId: string;
  targetUrl: string;
  confidence?: number;
}

interface RawMappingRow {
  source_marketplace: ComparisonMarketplace;
  source_product_id: string;
  target_marketplace: ComparisonMarketplace;
  target_product_id: string;
  target_url: string;
  confidence?: number | null;
  hits?: number | null;
  rank?: number | null;
  status?: MappingStatus | null;
  evidence?: MappingEvidence | null;
}

function reconstructUrl(
  marketplace: ComparisonMarketplace,
  productId: string,
  url?: string,
): string {
  if (url?.startsWith('http')) {
    return normalizeCompareUrl(url);
  }
  if (marketplace === 'wildberries') {
    return buildWildberriesUrl(productId);
  }
  if (marketplace === 'ozon') {
    return toCanonicalProductUrl(`https://www.ozon.ru/product/${productId}/`, 'ozon');
  }
  return toCanonicalProductUrl(
    `https://market.yandex.ru/product/${productId}`,
    'yandex_market',
  );
}

function rowToMapping(row: RawMappingRow): CrossMarketMapping {
  return {
    sourceMarketplace: row.source_marketplace,
    sourceProductId: row.source_product_id,
    targetMarketplace: row.target_marketplace,
    targetProductId: row.target_product_id,
    targetUrl: reconstructUrl(row.target_marketplace, row.target_product_id, row.target_url),
    confidence: row.confidence ?? undefined,
    hits: row.hits ?? undefined,
    rank: row.rank ?? 0,
    status: row.status ?? 'active',
    evidence: row.evidence ?? 'auto',
  };
}

/** Все active edges (primary + alternates), sorted by rank */
export async function lookupCrossMarketMappings(
  sourceMarketplace: ComparisonMarketplace,
  sourceProductId: string,
  targetMarketplace: ComparisonMarketplace,
): Promise<CrossMarketMapping[]> {
  if (!sourceProductId || sourceMarketplace === targetMarketplace) return [];

  const res = await callEdgeSafe<{
    ok: boolean;
    mapping: RawMappingRow | null;
    mappings?: RawMappingRow[] | null;
  }>('cross-market-map', {
    action: 'lookup',
    sourceMarketplace,
    sourceProductId,
    targetMarketplace,
  });

  const rows = res?.mappings?.length
    ? res.mappings
    : res?.mapping
      ? [res.mapping]
      : [];

  return rows.filter((r) => r?.target_product_id).map(rowToMapping);
}

/** Primary active mapping (compat) */
export async function lookupCrossMarketMapping(
  sourceMarketplace: ComparisonMarketplace,
  sourceProductId: string,
  targetMarketplace: ComparisonMarketplace,
): Promise<CrossMarketMapping | null> {
  const list = await lookupCrossMarketMappings(
    sourceMarketplace,
    sourceProductId,
    targetMarketplace,
  );
  return list[0] ?? null;
}

/** Сохранить primary (+ optional alternates) */
export async function rememberCrossMarketMapping(params: {
  sourceMarketplace: ComparisonMarketplace;
  sourceProductId: string;
  sourceUrl?: string;
  targetMarketplace: ComparisonMarketplace;
  targetUrl: string;
  confidence?: number;
  evidence?: MappingEvidence;
  alternates?: Array<{ targetUrl: string; confidence?: number }>;
}): Promise<void> {
  const {
    sourceMarketplace,
    sourceProductId,
    sourceUrl,
    targetMarketplace,
    targetUrl,
    confidence,
    evidence = 'auto',
    alternates,
  } = params;

  if (!sourceProductId || sourceMarketplace === targetMarketplace) return;
  if (!targetUrl || !/^https?:\/\//i.test(targetUrl)) return;

  if (confidence != null && confidence < AUTO_PICK_CONFIDENCE_THRESHOLD && evidence === 'auto') {
    return;
  }

  const targetProductId = extractComparisonArticle(targetUrl, targetMarketplace);
  if (!targetProductId) return;

  const altPayload: MappingAlternate[] = [];
  for (const alt of alternates ?? []) {
    if (!alt.targetUrl || alt.targetUrl === targetUrl) continue;
    const id = extractComparisonArticle(alt.targetUrl, targetMarketplace);
    if (!id || id === targetProductId) continue;
    altPayload.push({
      targetProductId: id,
      targetUrl: normalizeCompareUrl(alt.targetUrl),
      confidence: alt.confidence,
    });
    if (altPayload.length >= 2) break;
  }

  await callEdgeSafe('cross-market-map', {
    action: 'upsert',
    sourceMarketplace,
    sourceProductId,
    sourceUrl: sourceUrl ? normalizeCompareUrl(sourceUrl) : undefined,
    targetMarketplace,
    targetProductId,
    targetUrl: normalizeCompareUrl(targetUrl),
    confidence,
    evidence,
    rank: 0,
    alternates: altPayload,
  });
}

/** Пометить связь как disputed (после «не тот товар») */
export async function disputeCrossMarketMapping(params: {
  sourceMarketplace: ComparisonMarketplace;
  sourceProductId: string;
  targetMarketplace: ComparisonMarketplace;
  targetUrl: string;
}): Promise<void> {
  const { sourceMarketplace, sourceProductId, targetMarketplace, targetUrl } = params;
  if (!sourceProductId || !targetUrl) return;

  const targetProductId = extractComparisonArticle(targetUrl, targetMarketplace);

  await callEdgeSafe('cross-market-map', {
    action: 'dispute',
    sourceMarketplace,
    sourceProductId,
    targetMarketplace,
    targetProductId: targetProductId || undefined,
    targetUrl: normalizeCompareUrl(targetUrl),
  });
}

/** Карточка не открылась / 404 — увеличить fail_count */
export async function reportCrossMarketMappingFail(params: {
  sourceMarketplace: ComparisonMarketplace;
  sourceProductId: string;
  targetMarketplace: ComparisonMarketplace;
  targetUrl: string;
}): Promise<void> {
  const { sourceMarketplace, sourceProductId, targetMarketplace, targetUrl } = params;
  if (!sourceProductId || !targetUrl) return;

  const targetProductId = extractComparisonArticle(targetUrl, targetMarketplace);

  await callEdgeSafe('cross-market-map', {
    action: 'reportFail',
    sourceMarketplace,
    sourceProductId,
    targetMarketplace,
    targetProductId: targetProductId || undefined,
    targetUrl: normalizeCompareUrl(targetUrl),
  });
}

export function resolveSourceProductId(params: {
  sourceMarketplace: ComparisonMarketplace;
  sourceUrl?: string;
  article?: string;
  articlesByMarketplace?: Partial<Record<ComparisonMarketplace, string>>;
}): string | null {
  const fromArticles = params.articlesByMarketplace?.[params.sourceMarketplace]?.trim();
  if (fromArticles) return fromArticles;
  if (params.article?.trim()) return params.article.trim();
  if (params.sourceUrl) {
    const id = extractComparisonArticle(params.sourceUrl, params.sourceMarketplace);
    if (id) return id;
  }
  return null;
}
