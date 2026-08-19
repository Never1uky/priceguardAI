/**
 * Client-side AgentSearchResult (copy of the Edge jsonb shape).
 * Do not import supabase/functions/_shared/agent-orchestrator.ts into the popup.
 */

import { EdgeError } from '@/lib/supabase/edge';
import type { AgentSearchStatus } from '@/lib/shopping-agent-client';
import type { Marketplace } from '@/types/product';

export const AGENT_DAILY_CAP_USER_MESSAGE =
  'Сегодня лимит подборов исчерпан (5 в день). Повторите завтра.';

export const AGENT_STATUS_LABELS: Record<AgentSearchStatus, string> = {
  pending: 'Готовим запрос',
  searching: 'Ищем на WB, Ozon и Маркете',
  evaluating: 'Отбираем подходящие',
  ranking: 'Составляем рекомендацию',
  done: 'Готово',
  failed: 'Не удалось подобрать',
};

const MARKETPLACES: ReadonlySet<string> = new Set(['wildberries', 'ozon', 'yandex_market']);

export type AgentMarketplace = Marketplace;

export type AgentEvaluatedCandidate = {
  title: string;
  url: string;
  price: number | null;
  matchConfidence: number;
  marketplace: AgentMarketplace;
  productId?: string;
  matches: boolean;
  reason: string;
  imageUrl?: string;
};

export type AgentRankedItem = {
  productId: string;
  score: number;
  reason: string;
};

export type AgentSearchResult = {
  searchId: string;
  status: 'done' | 'failed';
  summary: string;
  ranked: AgentRankedItem[];
  matched: AgentEvaluatedCandidate[];
  disclosure: boolean;
  stepsTaken: number;
  searchesUsed: number;
  costEstimateRub: number;
  error?: string;
};

export type AgentOfferRow = AgentEvaluatedCandidate & {
  score?: number;
  rankReason?: string;
};

export function agentStatusLabel(status: AgentSearchStatus): string {
  return AGENT_STATUS_LABELS[status] ?? status;
}

export function agentSubmitErrorMessage(error: unknown): string {
  if (error instanceof EdgeError && error.code === 'agent_daily_cap') {
    return AGENT_DAILY_CAP_USER_MESSAGE;
  }
  if (error instanceof Error && error.message.trim()) return error.message;
  return 'Не удалось запустить подбор';
}

function asMarketplace(value: unknown): AgentMarketplace | null {
  return typeof value === 'string' && MARKETPLACES.has(value)
    ? (value as AgentMarketplace)
    : null;
}

function parseRankedItem(raw: unknown): AgentRankedItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.productId !== 'string' || !row.productId) return null;
  const score = typeof row.score === 'number' && Number.isFinite(row.score) ? row.score : 0;
  return {
    productId: row.productId,
    score,
    reason: typeof row.reason === 'string' ? row.reason : '',
  };
}

function parseMatchedItem(raw: unknown): AgentEvaluatedCandidate | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const marketplace = asMarketplace(row.marketplace);
  if (typeof row.title !== 'string' || !row.title) return null;
  if (typeof row.url !== 'string' || !row.url) return null;
  if (!marketplace) return null;
  const price =
    row.price == null
      ? null
      : typeof row.price === 'number' && Number.isFinite(row.price)
        ? row.price
        : null;
  return {
    title: row.title,
    url: row.url,
    price,
    matchConfidence: typeof row.matchConfidence === 'number' ? row.matchConfidence : 0,
    marketplace,
    productId: typeof row.productId === 'string' && row.productId ? row.productId : undefined,
    matches: row.matches !== false,
    reason: typeof row.reason === 'string' ? row.reason : '',
    imageUrl: typeof row.imageUrl === 'string' ? row.imageUrl : undefined,
  };
}

export function parseAgentSearchResult(raw: unknown): AgentSearchResult | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  if (row.status !== 'done' && row.status !== 'failed') return null;
  if (typeof row.summary !== 'string') return null;
  if (!Array.isArray(row.ranked) || !Array.isArray(row.matched)) return null;

  const ranked = row.ranked.map(parseRankedItem).filter((x): x is AgentRankedItem => x != null);
  const matched = row.matched
    .map(parseMatchedItem)
    .filter((x): x is AgentEvaluatedCandidate => x != null);

  return {
    searchId: typeof row.searchId === 'string' ? row.searchId : '',
    status: row.status,
    summary: row.summary,
    ranked,
    matched,
    disclosure: Boolean(row.disclosure),
    stepsTaken: typeof row.stepsTaken === 'number' ? row.stepsTaken : 0,
    searchesUsed: typeof row.searchesUsed === 'number' ? row.searchesUsed : 0,
    costEstimateRub: typeof row.costEstimateRub === 'number' ? row.costEstimateRub : 0,
    error: typeof row.error === 'string' ? row.error : undefined,
  };
}

/** Ranked order first; fall back to matched if rank list is empty. Only matches:true. */
export function joinAgentOffers(result: AgentSearchResult): AgentOfferRow[] {
  const accepted = result.matched.filter((item) => item.matches !== false);
  const byId = new Map<string, AgentEvaluatedCandidate>();
  for (const item of accepted) {
    const key = item.productId || item.url;
    byId.set(key, item);
  }

  if (result.ranked.length) {
    const rows: AgentOfferRow[] = [];
    for (const rank of result.ranked) {
      const hit =
        byId.get(rank.productId) ??
        accepted.find((m) => m.productId === rank.productId);
      if (!hit) continue;
      rows.push({ ...hit, score: rank.score, rankReason: rank.reason });
    }
    if (rows.length) return rows;
  }

  return accepted.map((item) => ({ ...item }));
}
