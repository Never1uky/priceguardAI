/**
 * Shopping-agent tool wrappers. No new search/match engine — only existing
 * marketplace-search-core, fetchMarketplacePriceDetailed, callProvider, upsertTrackedProduct.
 */

import { AGENT_MAX_PRODUCTS_AFTER_FILTER, AGENT_MAX_PRODUCTS_BEFORE_FILTER } from './agent-budget.ts';
import {
  callProvider,
  logAiRequest,
  MODELS,
  type CallProviderResult,
  type ChatMessage,
  type Provider,
} from './ai-provider.ts';
import {
  buildAgentJudgeSystem,
  buildAgentJudgeUser,
  buildAgentRankSystem,
  buildAgentRankUser,
} from './agent-prompts.ts';
import { fetchMarketplacePriceDetailed } from './marketplace-prices.ts';
import {
  MARKETPLACE_SEARCHERS,
  type Marketplace,
  type SearchCandidate,
} from './marketplace-search-core.ts';
import { extractProductId } from './product-url.ts';
import { projectScraperCredentials } from './reviews-common.ts';
import { upsertTrackedProduct } from './tracked-upsert.ts';

export const SEARCH_RESULTS_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
export const AGENT_AI_PIPELINE = 'agent';

/** Cheap tier — same grok-3-mini as lite chat. */
export const AGENT_CHEAP_PROVIDER: Provider = 'grok';
/** Medium tier — same gpt-4o-mini JSON synthesis as FULL_ANALYSIS. */
export const AGENT_MEDIUM_PROVIDER: Provider = 'openai';

export type AgentCandidate = SearchCandidate & {
  marketplace: Marketplace;
  productId?: string;
};

export type EvaluatedCandidate = AgentCandidate & {
  matches: boolean;
  reason: string;
};

export type AgentRankResult = {
  ranked: Array<{ productId: string; score: number; reason: string }>;
  summary: string;
  rawText: string;
};

type AgentSupabase = {
  from: (table: string) => {
    select: (...args: unknown[]) => unknown;
    upsert: (...args: unknown[]) => unknown;
    insert?: (...args: unknown[]) => unknown;
    eq?: (...args: unknown[]) => unknown;
  };
};

export type AgentSearcher = (query: string, referenceTitle: string) => Promise<SearchCandidate[]>;

export type AgentToolDeps = {
  searchers?: Partial<Record<Marketplace, AgentSearcher>>;
  callProvider?: typeof callProvider;
  logRequest?: typeof logAiRequest;
  nowMs?: number;
  userId?: string | null;
  /** Skip search_results_cache (agent search-again). */
  bypassCache?: boolean;
};

export function normalizeAgentQuery(query: string): string {
  return query.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function isSearchCacheFresh(
  fetchedAt: string | null | undefined,
  nowMs = Date.now(),
  ttlMs = SEARCH_RESULTS_CACHE_TTL_MS,
): boolean {
  if (!fetchedAt) return false;
  const t = Date.parse(fetchedAt);
  if (!Number.isFinite(t)) return false;
  return nowMs - t < ttlMs;
}

export function capAgentShortlist<T>(items: T[], max = AGENT_MAX_PRODUCTS_AFTER_FILTER): T[] {
  const limit = Number.isFinite(max) && max > 0 ? Math.floor(max) : AGENT_MAX_PRODUCTS_AFTER_FILTER;
  return items.slice(0, limit);
}

function withMarketplace(
  marketplace: Marketplace,
  rows: SearchCandidate[],
): AgentCandidate[] {
  return rows.map((row) => ({
    ...row,
    marketplace,
    productId: extractProductId(row.url, marketplace) || undefined,
  }));
}

function asCandidates(raw: unknown, marketplace: Marketplace): AgentCandidate[] {
  if (!Array.isArray(raw)) return [];
  return withMarketplace(
    marketplace,
    raw.filter((row): row is SearchCandidate =>
      Boolean(row && typeof row === 'object' && typeof (row as SearchCandidate).url === 'string'),
    ),
  );
}

async function readSearchCache(
  supabase: AgentSupabase,
  normalizedQuery: string,
  marketplace: Marketplace,
): Promise<{ candidates: unknown; fetched_at: string } | null> {
  const { data, error } = await (supabase.from('search_results_cache') as {
    select: (cols: string) => {
      eq: (col: string, val: string) => {
        eq: (col: string, val: string) => {
          maybeSingle: () => Promise<{ data: { candidates: unknown; fetched_at: string } | null; error: unknown }>;
        };
      };
    };
  })
    .select('candidates, fetched_at')
    .eq('normalized_query', normalizedQuery)
    .eq('marketplace', marketplace)
    .maybeSingle();
  if (error || !data) return null;
  return data;
}

async function writeSearchCache(
  supabase: AgentSupabase,
  normalizedQuery: string,
  marketplace: Marketplace,
  candidates: SearchCandidate[],
): Promise<void> {
  try {
    await (supabase.from('search_results_cache') as {
      upsert: (row: Record<string, unknown>, opts: { onConflict: string }) => Promise<unknown>;
    }).upsert(
      {
        normalized_query: normalizedQuery,
        marketplace,
        candidates,
        fetched_at: new Date().toISOString(),
      },
      { onConflict: 'normalized_query,marketplace' },
    );
  } catch (error) {
    console.warn('[agent-tools] search_results_cache upsert', error);
  }
}

export async function searchProducts(
  supabase: AgentSupabase,
  query: string,
  marketplaces: Marketplace[],
  deps: AgentToolDeps = {},
): Promise<AgentCandidate[]> {
  const normalized = normalizeAgentQuery(query);
  if (!normalized) return [];

  const unique = [...new Set(marketplaces)];
  const nowMs = deps.nowMs ?? Date.now();

  const batches = await Promise.all(
    unique.map(async (marketplace) => {
      const cached = deps.bypassCache
        ? null
        : await readSearchCache(supabase, normalized, marketplace);
      if (cached && isSearchCacheFresh(cached.fetched_at, nowMs)) {
        return asCandidates(cached.candidates, marketplace);
      }

      const searcher = deps.searchers?.[marketplace] ?? MARKETPLACE_SEARCHERS[marketplace];
      let found: SearchCandidate[] = [];
      try {
        found = await searcher(query, query);
      } catch (error) {
        console.warn('[agent-tools] search', marketplace, error);
      }
      await writeSearchCache(supabase, normalized, marketplace, found);
      return withMarketplace(marketplace, found);
    }),
  );

  return batches.flat().slice(0, AGENT_MAX_PRODUCTS_BEFORE_FILTER);
}

export async function getProductDetails(
  supabase: AgentSupabase,
  marketplace: Marketplace,
  productId: string,
) {
  const scraper = projectScraperCredentials();
  return fetchMarketplacePriceDetailed(marketplace, productId, undefined, {
    supabase: supabase as never,
    scraper: scraper ?? undefined,
  });
}

/** Stage 4: prompt builders live in agent-prompts.ts. */
function buildJudgeMessages(candidate: AgentCandidate, softConstraints: string[]): ChatMessage[] {
  return [
    { role: 'system', content: buildAgentJudgeSystem() },
    { role: 'user', content: buildAgentJudgeUser(candidate, softConstraints) },
  ];
}

function buildRankMessages(evaluated: EvaluatedCandidate[]): ChatMessage[] {
  return [
    { role: 'system', content: buildAgentRankSystem() },
    { role: 'user', content: buildAgentRankUser(evaluated) },
  ];
}

async function runAgentAi(
  supabase: AgentSupabase,
  provider: Provider,
  messages: ChatMessage[],
  deps: AgentToolDeps,
  maxTokens: number,
): Promise<CallProviderResult> {
  const invoke = deps.callProvider ?? callProvider;
  const log = deps.logRequest ?? logAiRequest;
  const started = Date.now();
  try {
    const result = await invoke(provider, messages, 0.2, maxTokens, true);
    await log(supabase as never, {
      userId: deps.userId,
      provider,
      model: result.model,
      success: true,
      durationMs: Date.now() - started,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      pipeline: AGENT_AI_PIPELINE,
    });
    return result;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    await log(supabase as never, {
      userId: deps.userId,
      provider,
      model: MODELS[provider],
      success: false,
      error: msg,
      durationMs: Date.now() - started,
      pipeline: AGENT_AI_PIPELINE,
    });
    throw error;
  }
}

function parseJudgeResult(text: string, candidate: AgentCandidate): EvaluatedCandidate {
  try {
    const json = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, '').trim()) as {
      matches?: boolean;
      reason?: string;
    };
    return {
      ...candidate,
      matches: json.matches !== false,
      reason: String(json.reason ?? ''),
    };
  } catch {
    return { ...candidate, matches: false, reason: 'invalid_json' };
  }
}

export async function analyzeCandidates(
  supabase: AgentSupabase,
  shortlist: AgentCandidate[],
  softConstraints: string[],
  deps: AgentToolDeps = {},
): Promise<EvaluatedCandidate[]> {
  const capped = capAgentShortlist(shortlist, AGENT_MAX_PRODUCTS_AFTER_FILTER);
  if (capped.length === 0) return [];
  return Promise.all(
    capped.map(async (candidate) => {
      const result = await runAgentAi(
        supabase,
        AGENT_CHEAP_PROVIDER,
        buildJudgeMessages(candidate, softConstraints),
        deps,
        400,
      );
      return parseJudgeResult(result.text, candidate);
    }),
  );
}

export async function rankAndExplain(
  supabase: AgentSupabase,
  evaluatedCandidates: EvaluatedCandidate[],
  deps: AgentToolDeps = {},
): Promise<AgentRankResult> {
  const capped = capAgentShortlist(evaluatedCandidates, AGENT_MAX_PRODUCTS_AFTER_FILTER);
  const result = await runAgentAi(
    supabase,
    AGENT_MEDIUM_PROVIDER,
    buildRankMessages(capped),
    deps,
    1_000,
  );
  try {
    const parsed = JSON.parse(result.text.replace(/^```(?:json)?\s*|\s*```$/g, '').trim()) as AgentRankResult;
    return {
      ranked: Array.isArray(parsed.ranked) ? parsed.ranked : [],
      summary: String(parsed.summary ?? ''),
      rawText: result.text,
    };
  } catch {
    return { ranked: [], summary: '', rawText: result.text };
  }
}

export async function trackProduct(
  supabase: AgentSupabase,
  userId: string,
  marketplace: Marketplace,
  productId: string,
) {
  return upsertTrackedProduct(supabase as never, {
    userId,
    marketplace,
    productId,
  });
}
