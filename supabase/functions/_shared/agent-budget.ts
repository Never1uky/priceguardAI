import { shouldStopByRuntimeBudget } from './update-prices-policy.ts';

export const AGENT_MAX_STEPS = 6;
export const AGENT_MAX_SEARCHES = 3;
export const AGENT_MAX_PRODUCTS_BEFORE_FILTER = 30;
export const AGENT_MAX_PRODUCTS_AFTER_FILTER = 10;
/** Headroom over worst-case ~0.56₽ per search. */
export const AGENT_MAX_COST_RUB = 1.0;
/**
 * Wall-clock cap for one orchestrator run. Edge Functions typically allow
 * 60–150s; 45s leaves room for PARSE/SEARCH/EVALUATE/RANK without hitting
 * the platform limit (update-prices uses 115s for a cron sweep).
 */
export const AGENT_RUNTIME_BUDGET_MS = 45_000;
/** Agent searches per user per UTC day — same order of magnitude as DEFAULT_SONAR_DAILY_CAP. */
export const DEFAULT_AGENT_DAILY_CAP = 5;

export type AgentLoopState = {
  stepsTaken: number;
  searchesUsed: number;
  costSoFarRub: number;
};

export type AgentLoopDecision =
  | { action: 'continue' }
  | { action: 'stop'; reason: 'max_steps' | 'max_searches' | 'max_cost' };

/**
 * Pure loop guard. Stop reasons are checked in this order so a fully spent
 * run reports the structural limit first (steps → searches → cost).
 */
export function shouldContinueAgentLoop(state: AgentLoopState): AgentLoopDecision {
  const steps = Number.isFinite(state.stepsTaken) ? state.stepsTaken : 0;
  const searches = Number.isFinite(state.searchesUsed) ? state.searchesUsed : 0;
  const cost = Number.isFinite(state.costSoFarRub) ? state.costSoFarRub : 0;

  if (steps >= AGENT_MAX_STEPS) return { action: 'stop', reason: 'max_steps' };
  if (searches >= AGENT_MAX_SEARCHES) return { action: 'stop', reason: 'max_searches' };
  if (cost >= AGENT_MAX_COST_RUB) return { action: 'stop', reason: 'max_cost' };
  return { action: 'continue' };
}

/** Same comparison as update-prices; argument order matches the agent prompt. */
export function shouldStopByAgentRuntimeBudget(
  startedAtMs: number,
  nowMs: number,
  budgetMs = AGENT_RUNTIME_BUDGET_MS,
): boolean {
  return shouldStopByRuntimeBudget(startedAtMs, budgetMs, nowMs);
}

/** Minimal count-query surface so this file stays free of createClient / esm.sh. */
export type AgentBudgetCountClient = {
  from: (table: string) => {
    select: (
      columns: string,
      options: { count: 'exact'; head: true },
    ) => {
      eq: (column: string, value: string) => {
        gte: (
          column: string,
          value: string,
        ) => Promise<{ count: number | null; error: unknown }>;
      };
    };
  };
};

export function isAgentDailyCountCapped(
  count: number | null | undefined,
  cap: number,
): boolean {
  if (!Number.isFinite(cap) || cap <= 0) return false;
  return (count ?? 0) >= cap;
}

/**
 * Daily cap on agent_searches rows for this user since UTC midnight.
 * Fail-open on missing userId or query error (same as isSonarDailyCapped).
 */
export async function isAgentDailyCapped(
  supabase: AgentBudgetCountClient,
  userId: string | null | undefined,
  cap = DEFAULT_AGENT_DAILY_CAP,
): Promise<boolean> {
  if (!userId) return false;
  if (!Number.isFinite(cap) || cap <= 0) return false;

  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);

  const { count, error } = await supabase
    .from('agent_searches')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', start.toISOString());

  if (error) {
    console.error('agent daily cap check failed', error);
    return false;
  }
  return isAgentDailyCountCapped(count, cap);
}
