/**
 * Shopping-agent loop: PARSE → SEARCH → EVALUATE → RANK | SEARCH AGAIN.
 * Branching is in decideNextAgentStep (pure). runAgentSearch talks to DB/AI.
 */

import {
  AGENT_MAX_COST_RUB,
  AGENT_MAX_STEPS,
  shouldContinueAgentLoop,
  shouldStopByAgentRuntimeBudget,
} from './agent-budget.ts';
import {
  buildAgentParseSystem,
  buildAgentParseUser,
} from './agent-prompts.ts';
import {
  AGENT_AI_PIPELINE,
  AGENT_CHEAP_PROVIDER,
  analyzeCandidates,
  capAgentShortlist,
  rankAndExplain,
  searchProducts,
  type AgentCandidate,
  type AgentRankResult,
  type AgentToolDeps,
  type EvaluatedCandidate,
} from './agent-tools.ts';
import { callProvider, logAiRequest, MODELS } from './ai-provider.ts';
import type { Marketplace } from './marketplace-search-core.ts';

export const AGENT_ENOUGH_MATCHED = 3;
export const AGENT_PARSE_COST_RUB = 0.05;
export const AGENT_JUDGE_COST_RUB = 0.03;
export const AGENT_RANK_COST_RUB = 0.12;

const ALL_MARKETPLACES: Marketplace[] = ['wildberries', 'ozon', 'yandex_market'];

/** Cyrillic tokens: \b is ASCII-only, so delimit on whitespace/punctuation instead. */
const CONSTRAINT_RE =
  /(?:^|[\s,.:;!?])(?:до|от|не\s+менее|не\s+более|бюджет|дешевле|не\s+дороже|минимум|максимум)(?:$|[\s,.:;!?\d])/i;

export type AgentSearchStatus =
  | 'pending'
  | 'searching'
  | 'evaluating'
  | 'ranking'
  | 'done'
  | 'failed';

export type AgentStepPhase = 'start' | 'parsed' | 'searched' | 'evaluated' | 'ranked';

export type AgentOrchestratorState = {
  phase: AgentStepPhase;
  query: string;
  stepsTaken: number;
  searchesUsed: number;
  costSoFarRub: number;
  matchedCount: number;
  startedAtMs: number;
  nowMs: number;
};

export type AgentNextStep =
  | { action: 'parse' }
  | { action: 'search'; skipParse: boolean }
  | { action: 'evaluate' }
  | { action: 'rank' }
  | { action: 'answer'; disclosure: boolean };

export type ParsedAgentQuery = {
  category: string | null;
  budget: number | null;
  hardConstraints: Array<{ attribute: string; comparator: string; value: string }>;
  softConstraints: string[];
  searchQuery: string;
};

export type AgentSearchResult = {
  searchId: string;
  status: 'done' | 'failed';
  summary: string;
  ranked: AgentRankResult['ranked'];
  matched: EvaluatedCandidate[];
  disclosure: boolean;
  stepsTaken: number;
  searchesUsed: number;
  costEstimateRub: number;
  error?: string;
};

type OrchestratorSupabase = {
  from: (table: string) => {
    update: (row: Record<string, unknown>) => {
      eq: (col: string, val: string) => {
        eq: (col: string, val: string) => Promise<unknown>;
      };
    };
    select?: (...args: unknown[]) => unknown;
    upsert?: (...args: unknown[]) => unknown;
  };
};

/** Short query without budget/constraint words → treat as a model name, skip AI parse. */
export function looksLikeExactModelQuery(query: string): boolean {
  const text = String(query ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!text) return false;
  if (CONSTRAINT_RE.test(text)) return false;
  const words = text.split(' ').filter(Boolean);
  return words.length > 0 && words.length <= 8 && text.length <= 80;
}

function agentLoopDecision(state: AgentOrchestratorState) {
  return shouldContinueAgentLoop({
    stepsTaken: state.stepsTaken,
    searchesUsed: state.searchesUsed,
    costSoFarRub: state.costSoFarRub,
  });
}

/** Runtime / max_steps / max_cost — stop any further PARSE/EVALUATE/RANK/SEARCH. */
function isHardBudgetStop(state: AgentOrchestratorState): boolean {
  if (shouldStopByAgentRuntimeBudget(state.startedAtMs, state.nowMs)) return true;
  const loop = agentLoopDecision(state);
  return loop.action === 'stop' && loop.reason !== 'max_searches';
}

/**
 * Another SEARCH is allowed only when the full loop guard says continue.
 * max_searches is a search cap, not a bar on evaluate/rank of the last SERP.
 */
function canIssueSearch(state: AgentOrchestratorState): boolean {
  if (isHardBudgetStop(state)) return false;
  return agentLoopDecision(state).action === 'continue';
}

/**
 * Pure next-step decision. Callers must invoke this before every step
 * (same pattern as shouldStopByRuntimeBudget in update-prices).
 */
export function decideNextAgentStep(state: AgentOrchestratorState): AgentNextStep {
  if (state.phase === 'ranked') {
    return { action: 'answer', disclosure: false };
  }

  if (state.phase === 'start') {
    if (isHardBudgetStop(state)) return { action: 'answer', disclosure: true };
    if (looksLikeExactModelQuery(state.query)) {
      return { action: 'search', skipParse: true };
    }
    return { action: 'parse' };
  }

  if (state.phase === 'parsed') {
    if (!canIssueSearch(state)) return { action: 'answer', disclosure: true };
    return { action: 'search', skipParse: false };
  }

  if (state.phase === 'searched') {
    if (isHardBudgetStop(state)) return { action: 'answer', disclosure: true };
    return { action: 'evaluate' };
  }

  if (state.phase === 'evaluated') {
    if (state.matchedCount >= AGENT_ENOUGH_MATCHED) {
      if (isHardBudgetStop(state)) return { action: 'answer', disclosure: true };
      return { action: 'rank' };
    }
    if (canIssueSearch(state)) {
      return { action: 'search', skipParse: false };
    }
    return { action: 'answer', disclosure: true };
  }

  return { action: 'answer', disclosure: true };
}

function defaultParsed(query: string): ParsedAgentQuery {
  return {
    category: null,
    budget: null,
    hardConstraints: [],
    softConstraints: [],
    searchQuery: query.trim(),
  };
}

function parseAgentJson(text: string, fallbackQuery: string): ParsedAgentQuery {
  const fallback = defaultParsed(fallbackQuery);
  try {
    const json = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, '').trim()) as {
      category?: unknown;
      budget?: unknown;
      hardConstraints?: unknown;
      softConstraints?: unknown;
    };
    const budgetRaw = json.budget;
    const budget =
      typeof budgetRaw === 'number' && Number.isFinite(budgetRaw) && budgetRaw > 0
        ? budgetRaw
        : null;
    const hard = Array.isArray(json.hardConstraints)
      ? json.hardConstraints.filter((row) => row && typeof row === 'object') as ParsedAgentQuery['hardConstraints']
      : [];
    const soft = Array.isArray(json.softConstraints)
      ? json.softConstraints.map((s) => String(s)).filter(Boolean)
      : [];
    return {
      category: json.category == null ? null : String(json.category),
      budget,
      hardConstraints: hard,
      softConstraints: soft,
      searchQuery: fallbackQuery.trim(),
    };
  } catch {
    return fallback;
  }
}

function buildMarketplaceQuery(parsed: ParsedAgentQuery, searchesUsed: number): string {
  let q = parsed.searchQuery.trim();
  const category = parsed.category?.trim();
  if (category && !q.toLowerCase().includes(category.toLowerCase())) {
    q = `${q} ${category}`;
  }
  if (searchesUsed > 1 && parsed.hardConstraints.length) {
    const extra = parsed.hardConstraints
      .map((h) => `${h.attribute} ${h.value}`.trim())
      .filter(Boolean)
      .join(' ');
    if (extra) q = `${q} ${extra}`;
  }
  return q.trim();
}

function applyBudgetFilter(
  candidates: AgentCandidate[],
  budget: number | null,
): AgentCandidate[] {
  if (budget == null || budget <= 0) return candidates;
  return candidates.filter((c) => c.price == null || c.price <= budget);
}

async function persistProgress(
  supabase: OrchestratorSupabase,
  searchId: string,
  userId: string,
  patch: {
    status: AgentSearchStatus;
    stepsTaken: number;
    costEstimateRub: number;
    result?: unknown;
    error?: string | null;
    constraints?: ParsedAgentQuery;
  },
): Promise<void> {
  try {
    await supabase
      .from('agent_searches')
      .update({
        status: patch.status,
        steps_taken: patch.stepsTaken,
        cost_estimate_rub: patch.costEstimateRub,
        updated_at: new Date().toISOString(),
        ...(patch.result !== undefined ? { result: patch.result } : {}),
        ...(patch.error !== undefined ? { error: patch.error } : {}),
        ...(patch.constraints !== undefined ? { constraints: patch.constraints } : {}),
      })
      .eq('id', searchId)
      .eq('user_id', userId);
  } catch (error) {
    console.warn('[agent-orchestrator] persist', error);
  }
}

export type RunAgentSearchDeps = AgentToolDeps & {
  marketplaces?: Marketplace[];
  now?: () => number;
};

export async function runAgentSearch(
  supabase: OrchestratorSupabase,
  userId: string,
  query: string,
  searchId: string,
  deps: RunAgentSearchDeps = {},
): Promise<AgentSearchResult> {
  const startedAtMs = deps.now?.() ?? Date.now();
  const now = () => deps.now?.() ?? Date.now();
  const toolDeps: AgentToolDeps = { ...deps, userId };
  const marketplaces = deps.marketplaces ?? ALL_MARKETPLACES;

  let phase: AgentStepPhase = 'start';
  let stepsTaken = 0;
  let searchesUsed = 0;
  let costSoFarRub = 0;
  let parsed = defaultParsed(query);
  let candidates: AgentCandidate[] = [];
  let evaluated: EvaluatedCandidate[] = [];
  let ranked: AgentRankResult = { ranked: [], summary: '', rawText: '' };
  let disclosure = false;

  const snapshot = (): AgentOrchestratorState => ({
    phase,
    query,
    stepsTaken,
    searchesUsed,
    costSoFarRub,
    matchedCount: evaluated.filter((e) => e.matches).length,
    startedAtMs,
    nowMs: now(),
  });

  const bump = async (status: AgentSearchStatus) => {
    await persistProgress(supabase, searchId, userId, {
      status,
      stepsTaken,
      costEstimateRub: costSoFarRub,
    });
  };

  try {
    await bump('pending');

    for (let i = 0; i < AGENT_MAX_STEPS + 4; i += 1) {
      const next = decideNextAgentStep(snapshot());

      if (next.action === 'answer') {
        disclosure = next.disclosure;
        break;
      }

      if (next.action === 'parse') {
        stepsTaken += 1;
        await bump('searching');
        const invoke = deps.callProvider ?? callProvider;
        const log = deps.logRequest ?? logAiRequest;
        const t0 = now();
        try {
          const result = await invoke(
            AGENT_CHEAP_PROVIDER,
            [
              { role: 'system', content: buildAgentParseSystem() },
              { role: 'user', content: buildAgentParseUser(query) },
            ],
            0.2,
            400,
            true,
          );
          await log(supabase as never, {
            userId,
            provider: AGENT_CHEAP_PROVIDER,
            model: result.model,
            success: true,
            durationMs: now() - t0,
            promptTokens: result.promptTokens,
            completionTokens: result.completionTokens,
            pipeline: AGENT_AI_PIPELINE,
          });
          parsed = parseAgentJson(result.text, query);
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          await log(supabase as never, {
            userId,
            provider: AGENT_CHEAP_PROVIDER,
            model: MODELS[AGENT_CHEAP_PROVIDER],
            success: false,
            error: msg,
            durationMs: now() - t0,
            pipeline: AGENT_AI_PIPELINE,
          });
          parsed = defaultParsed(query);
        }
        costSoFarRub = Math.min(AGENT_MAX_COST_RUB, costSoFarRub + AGENT_PARSE_COST_RUB);
        phase = 'parsed';
        await persistProgress(supabase, searchId, userId, {
          status: 'searching',
          stepsTaken,
          costEstimateRub: costSoFarRub,
          constraints: parsed,
        });
        continue;
      }

      if (next.action === 'search') {
        if (next.skipParse) {
          parsed = defaultParsed(query);
        }
        stepsTaken += 1;
        searchesUsed += 1;
        await bump('searching');
        const searchQuery = buildMarketplaceQuery(parsed, searchesUsed);
        const found = await searchProducts(supabase as never, searchQuery, marketplaces, {
          ...toolDeps,
          bypassCache: searchesUsed > 1,
        });
        candidates = applyBudgetFilter(found, parsed.budget);
        phase = 'searched';
        await bump('searching');
        continue;
      }

      if (next.action === 'evaluate') {
        stepsTaken += 1;
        await bump('evaluating');
        const shortlist = capAgentShortlist(candidates);
        evaluated = await analyzeCandidates(
          supabase as never,
          shortlist,
          parsed.softConstraints,
          toolDeps,
        );
        costSoFarRub = Math.min(
          AGENT_MAX_COST_RUB,
          costSoFarRub + AGENT_JUDGE_COST_RUB * evaluated.length,
        );
        phase = 'evaluated';
        await bump('evaluating');
        continue;
      }

      if (next.action === 'rank') {
        stepsTaken += 1;
        await bump('ranking');
        const matched = evaluated.filter((e) => e.matches);
        ranked = await rankAndExplain(supabase as never, matched.length ? matched : evaluated, toolDeps);
        costSoFarRub = Math.min(AGENT_MAX_COST_RUB, costSoFarRub + AGENT_RANK_COST_RUB);
        phase = 'ranked';
        await bump('ranking');
      }
    }

    const matched = evaluated.filter((e) => e.matches);
    const result: AgentSearchResult = {
      searchId,
      status: 'done',
      summary: ranked.summary || (disclosure
        ? 'Мало подходящих товаров в рамках лимита шагов — вот что удалось найти.'
        : ''),
      ranked: ranked.ranked,
      matched,
      disclosure,
      stepsTaken,
      searchesUsed,
      costEstimateRub: costSoFarRub,
    };

    await persistProgress(supabase, searchId, userId, {
      status: 'done',
      stepsTaken,
      costEstimateRub: costSoFarRub,
      result,
      error: null,
    });
    return result;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    await persistProgress(supabase, searchId, userId, {
      status: 'failed',
      stepsTaken,
      costEstimateRub: costSoFarRub,
      error: msg,
    });
    return {
      searchId,
      status: 'failed',
      summary: '',
      ranked: [],
      matched: [],
      disclosure: true,
      stepsTaken,
      searchesUsed,
      costEstimateRub: costSoFarRub,
      error: msg,
    };
  }
}
