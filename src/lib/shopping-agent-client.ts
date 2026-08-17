/**
 * Client for shopping-agent Edge Function: submit + poll.
 * Keepalive / stale recovery / generation supersession follow compare-jobs.ts,
 * in a separate chrome.storage namespace so compare tracking is untouched.
 */

import {
  addRunningId,
  keepAliveShouldStart,
  keepAliveShouldStop,
  normalizeRunningAtMap,
  normalizeRunningIds,
  pruneStaleRunning,
  removeRunningId,
  type RunningAtMap,
} from '@/lib/compare-running-state';
import { getAccessToken } from '@/lib/supabase/auth';
import { functionsUrl, getSupabaseConfig } from '@/lib/supabase/config';
import { EdgeError } from '@/lib/supabase/edge';
import { getEdgeAuthHeaders } from '@/lib/supabase/edge-auth';

export const AGENT_RUNNING_KEY = 'priceguard_agent_running';
export const AGENT_RUNNING_IDS_KEY = 'priceguard_agent_running_ids';
export const AGENT_RUNNING_AT_KEY = 'priceguard_agent_running_at';
export const AGENT_RUNNING_AT_MAP_KEY = 'priceguard_agent_running_at_map';

/** Agent wall-clock is 45s; 2 min recovers a dead SW without blocking a live poll. */
export const AGENT_RUNNING_STALE_MS = 2 * 60 * 1000;
export const AGENT_POLL_INTERVAL_MS = 1_750;
const AGENT_KEEPALIVE_MS = 20_000;

export type AgentSearchStatus =
  | 'pending'
  | 'searching'
  | 'evaluating'
  | 'ranking'
  | 'done'
  | 'failed';

export type AgentSearchState = {
  id: string;
  query: string;
  status: AgentSearchStatus;
  steps_taken: number;
  cost_estimate_rub: number | null;
  result: unknown;
  error: string | null;
  constraints?: unknown;
  created_at?: string;
  updated_at?: string;
};

let keepAliveTimer: ReturnType<typeof setInterval> | null = null;
const keepAliveJobs = new Set<string>();

let agentEpoch = 0;
let agentPollGeneration = 0;
const activePollGenerations = new Map<string, number>();

let runningStateChain: Promise<void> = Promise.resolve();

function withRunningStateLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = runningStateChain.then(fn, fn);
  runningStateChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function startKeepAlive(jobId: string): void {
  keepAliveJobs.add(jobId);
  if (!keepAliveShouldStart(keepAliveJobs.size) || keepAliveTimer) return;
  keepAliveTimer = setInterval(() => {
    chrome.runtime.getPlatformInfo(() => {});
  }, AGENT_KEEPALIVE_MS);
}

function stopKeepAlive(jobId: string): void {
  keepAliveJobs.delete(jobId);
  if (!keepAliveShouldStop(keepAliveJobs.size)) return;
  if (keepAliveTimer) {
    clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  }
}

async function readRunningState(): Promise<{ ids: string[]; startedAt: RunningAtMap }> {
  const stored = await chrome.storage.local.get([
    AGENT_RUNNING_KEY,
    AGENT_RUNNING_IDS_KEY,
    AGENT_RUNNING_AT_KEY,
    AGENT_RUNNING_AT_MAP_KEY,
  ]);
  const fromIds = normalizeRunningIds(stored[AGENT_RUNNING_IDS_KEY]);
  const fromLegacy = normalizeRunningIds(stored[AGENT_RUNNING_KEY]);
  const ids = fromIds.length ? fromIds : fromLegacy;
  const startedAt = normalizeRunningAtMap(
    stored[AGENT_RUNNING_AT_MAP_KEY] ?? stored[AGENT_RUNNING_AT_KEY],
    ids,
    Date.now(),
  );
  return { ids, startedAt };
}

async function writeRunningState(ids: string[], startedAt: RunningAtMap): Promise<void> {
  if (!ids.length) {
    await chrome.storage.local.remove([
      AGENT_RUNNING_KEY,
      AGENT_RUNNING_IDS_KEY,
      AGENT_RUNNING_AT_KEY,
      AGENT_RUNNING_AT_MAP_KEY,
    ]);
    return;
  }
  await chrome.storage.local.set({
    [AGENT_RUNNING_IDS_KEY]: ids,
    [AGENT_RUNNING_KEY]: ids[0]!,
    [AGENT_RUNNING_AT_MAP_KEY]: startedAt,
    [AGENT_RUNNING_AT_KEY]: startedAt[ids[0]!] ?? Date.now(),
  });
}

export async function getRunningAgentSearchIds(): Promise<string[]> {
  return withRunningStateLock(async () => {
    const { ids, startedAt } = await readRunningState();
    const pruned = pruneStaleRunning(ids, startedAt, Date.now(), AGENT_RUNNING_STALE_MS);
    if (pruned.pruned.length || pruned.ids.length !== ids.length) {
      await writeRunningState(pruned.ids, pruned.startedAt);
    }
    return pruned.ids;
  });
}

export async function isAgentSearchRunning(searchId: string): Promise<boolean> {
  const ids = await getRunningAgentSearchIds();
  return ids.includes(searchId);
}

async function addAgentRunning(searchId: string): Promise<void> {
  await withRunningStateLock(async () => {
    const { ids, startedAt } = await readRunningState();
    const pruned = pruneStaleRunning(ids, startedAt, Date.now(), AGENT_RUNNING_STALE_MS);
    const next = addRunningId(pruned.ids, pruned.startedAt, searchId, Date.now());
    await writeRunningState(next.ids, next.startedAt);
  });
}

async function removeAgentRunning(searchId: string): Promise<void> {
  await withRunningStateLock(async () => {
    const { ids, startedAt } = await readRunningState();
    if (!ids.includes(searchId)) return;
    const next = removeRunningId(ids, startedAt, searchId);
    await writeRunningState(next.ids, next.startedAt);
  });
}

function isTerminalStatus(status: string): boolean {
  return status === 'done' || status === 'failed';
}

async function parseJson(response: Response): Promise<Record<string, unknown> | null> {
  const text = await response.text().catch(() => '');
  if (!text) return null;
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function throwIfEdgeFailed(response: Response, data: Record<string, unknown> | null): void {
  const errorMsg = typeof data?.error === 'string' ? data.error : null;
  const code = typeof data?.code === 'string' ? data.code : undefined;
  if (!response.ok || data?.ok === false) {
    throw new EdgeError(errorMsg || 'Ошибка shopping-agent', response.status, code);
  }
}

function asSearchState(raw: unknown): AgentSearchState | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const id = typeof row.id === 'string' ? row.id : '';
  const status = typeof row.status === 'string' ? row.status : '';
  if (!id || !status) return null;
  return {
    id,
    query: typeof row.query === 'string' ? row.query : '',
    status: status as AgentSearchStatus,
    steps_taken: typeof row.steps_taken === 'number' ? row.steps_taken : 0,
    cost_estimate_rub:
      typeof row.cost_estimate_rub === 'number' ? row.cost_estimate_rub : null,
    result: row.result ?? null,
    error: typeof row.error === 'string' ? row.error : null,
    constraints: row.constraints,
    created_at: typeof row.created_at === 'string' ? row.created_at : undefined,
    updated_at: typeof row.updated_at === 'string' ? row.updated_at : undefined,
  };
}

async function fetchAgentSearch(searchId: string): Promise<AgentSearchState> {
  const headers = await getEdgeAuthHeaders();
  const response = await fetch(
    `${functionsUrl('shopping-agent')}/${encodeURIComponent(searchId)}`,
    { method: 'GET', headers },
  );
  const data = await parseJson(response);
  throwIfEdgeFailed(response, data);
  const state = asSearchState(data?.search ?? data);
  if (!state) throw new EdgeError('Пустой ответ Edge Function', response.status);
  return state;
}

export async function submitAgentSearch(query: string): Promise<{ searchId: string }> {
  const trimmed = String(query ?? '').replace(/\s+/g, ' ').trim();
  if (!trimmed) throw new EdgeError('Укажите запрос', 400);

  agentEpoch += 1;

  if (!getSupabaseConfig().configured) {
    throw new EdgeError('Supabase не настроен');
  }
  const token = await getAccessToken();
  if (!token) {
    throw new EdgeError('Требуется авторизация', 401);
  }

  const headers = await getEdgeAuthHeaders();
  const response = await fetch(functionsUrl('shopping-agent'), {
    method: 'POST',
    headers,
    body: JSON.stringify({ query: trimmed }),
  });
  const data = await parseJson(response);
  throwIfEdgeFailed(response, data);

  const searchId = typeof data?.searchId === 'string' ? data.searchId : '';
  if (!searchId) throw new EdgeError('Пустой ответ Edge Function', response.status);

  await addAgentRunning(searchId);
  return { searchId };
}

/**
 * Poll GET until done/failed (or cleanup). Keepalive holds the SW like compare-jobs.
 * A newer submit/poll bumps generation and this loop stops without wiping the new job.
 */
export function pollAgentSearch(
  searchId: string,
  onUpdate: (state: AgentSearchState) => void,
): () => void {
  const id = String(searchId ?? '').trim();
  if (!id) return () => {};

  const epoch = agentEpoch;
  const generation = ++agentPollGeneration;
  const jobId = `${id}:${generation}`;
  activePollGenerations.set(id, generation);
  startKeepAlive(jobId);
  void addAgentRunning(id);

  let stopped = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  const isCurrent = () =>
    !stopped &&
    agentEpoch === epoch &&
    activePollGenerations.get(id) === generation;

  const cleanup = () => {
    if (stopped) return;
    stopped = true;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    const stillOwner = activePollGenerations.get(id) === generation;
    if (stillOwner) {
      activePollGenerations.delete(id);
      void removeAgentRunning(id);
    }
    stopKeepAlive(jobId);
  };

  const tick = async () => {
    if (!isCurrent()) {
      cleanup();
      return;
    }
    try {
      const state = await fetchAgentSearch(id);
      if (!isCurrent()) {
        cleanup();
        return;
      }
      onUpdate(state);
      if (isTerminalStatus(state.status)) cleanup();
    } catch (error) {
      if (!isCurrent()) {
        cleanup();
        return;
      }
      if (error instanceof EdgeError && error.status === 404) cleanup();
    }
  };

  void tick();
  timer = setInterval(() => {
    void tick();
  }, AGENT_POLL_INTERVAL_MS);

  return cleanup;
}

/** Test-only: drop keepalive / generation so suites do not leak timers. */
export function __resetShoppingAgentClientForTests(): void {
  agentEpoch = 0;
  agentPollGeneration = 0;
  activePollGenerations.clear();
  keepAliveJobs.clear();
  if (keepAliveTimer) {
    clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  }
  runningStateChain = Promise.resolve();
}
