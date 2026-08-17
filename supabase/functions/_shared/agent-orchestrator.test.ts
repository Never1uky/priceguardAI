import { describe, expect, it } from 'vitest';
import {
  AGENT_MAX_COST_RUB,
  AGENT_MAX_SEARCHES,
  AGENT_MAX_STEPS,
  AGENT_RUNTIME_BUDGET_MS,
} from './agent-budget.ts';
import {
  AGENT_ENOUGH_MATCHED,
  decideNextAgentStep,
  looksLikeExactModelQuery,
  type AgentOrchestratorState,
} from './agent-orchestrator.ts';

function state(over: Partial<AgentOrchestratorState> = {}): AgentOrchestratorState {
  return {
    phase: 'start',
    query: 'Google Pixel 8',
    stepsTaken: 0,
    searchesUsed: 0,
    costSoFarRub: 0,
    matchedCount: 0,
    startedAtMs: 0,
    nowMs: 0,
    ...over,
  };
}

describe('looksLikeExactModelQuery', () => {
  it('treats a short model name as exact (skip AI parse)', () => {
    expect(looksLikeExactModelQuery('Google Pixel 8')).toBe(true);
    expect(looksLikeExactModelQuery('Sony WH-1000XM5')).toBe(true);
  });

  it('does not skip parse when budget/constraint words are present', () => {
    expect(looksLikeExactModelQuery('пылесос до 15000')).toBe(false);
    expect(looksLikeExactModelQuery('наушники от 5000')).toBe(false);
    expect(looksLikeExactModelQuery('монитор не менее 27 дюймов')).toBe(false);
  });
});

describe('decideNextAgentStep', () => {
  it('deterministic pre-check: exact model name → search, skip parse', () => {
    expect(decideNextAgentStep(state({ phase: 'start', query: 'Google Pixel 8' }))).toEqual({
      action: 'search',
      skipParse: true,
    });
  });

  it('constrained free-text at start → parse', () => {
    expect(
      decideNextAgentStep(state({ phase: 'start', query: 'тихий пылесос до 15000' })),
    ).toEqual({ action: 'parse' });
  });

  it('runtime budget already exceeded → answer with disclosure', () => {
    expect(
      decideNextAgentStep(
        state({
          phase: 'start',
          query: 'тихий пылесос до 15000',
          startedAtMs: 0,
          nowMs: AGENT_RUNTIME_BUDGET_MS,
        }),
      ),
    ).toEqual({ action: 'answer', disclosure: true });
  });

  it('enough matched candidates after filter → rank', () => {
    expect(
      decideNextAgentStep(
        state({
          phase: 'evaluated',
          matchedCount: AGENT_ENOUGH_MATCHED,
          stepsTaken: 3,
          searchesUsed: 1,
          costSoFarRub: 0.2,
        }),
      ),
    ).toEqual({ action: 'rank' });
  });

  it('few matches and budget left → search again', () => {
    expect(
      decideNextAgentStep(
        state({
          phase: 'evaluated',
          matchedCount: 1,
          stepsTaken: 3,
          searchesUsed: 1,
          costSoFarRub: 0.2,
        }),
      ),
    ).toEqual({ action: 'search', skipParse: false });
  });

  it('few matches and search budget exhausted → answer with disclosure', () => {
    expect(
      decideNextAgentStep(
        state({
          phase: 'evaluated',
          matchedCount: 1,
          stepsTaken: 5,
          searchesUsed: AGENT_MAX_SEARCHES,
          costSoFarRub: 0.4,
        }),
      ),
    ).toEqual({ action: 'answer', disclosure: true });
  });

  it('few matches and max_cost/max_steps → answer with disclosure', () => {
    expect(
      decideNextAgentStep(
        state({
          phase: 'evaluated',
          matchedCount: 0,
          stepsTaken: AGENT_MAX_STEPS,
          searchesUsed: 1,
          costSoFarRub: 0,
        }),
      ),
    ).toEqual({ action: 'answer', disclosure: true });
    expect(
      decideNextAgentStep(
        state({
          phase: 'evaluated',
          matchedCount: 0,
          stepsTaken: 3,
          searchesUsed: 1,
          costSoFarRub: AGENT_MAX_COST_RUB,
        }),
      ),
    ).toEqual({ action: 'answer', disclosure: true });
  });

  it('after rank → answer without disclosure', () => {
    expect(decideNextAgentStep(state({ phase: 'ranked', matchedCount: 4 }))).toEqual({
      action: 'answer',
      disclosure: false,
    });
  });

  it('searched with budget left → evaluate (even if searchesUsed is at cap)', () => {
    expect(
      decideNextAgentStep(
        state({
          phase: 'searched',
          searchesUsed: AGENT_MAX_SEARCHES,
          stepsTaken: 3,
          costSoFarRub: 0.2,
        }),
      ),
    ).toEqual({ action: 'evaluate' });
  });

  it('enough matches after last allowed search → rank (max_searches does not skip rank)', () => {
    expect(
      decideNextAgentStep(
        state({
          phase: 'evaluated',
          matchedCount: AGENT_ENOUGH_MATCHED,
          stepsTaken: 5,
          searchesUsed: AGENT_MAX_SEARCHES,
          costSoFarRub: 0.4,
        }),
      ),
    ).toEqual({ action: 'rank' });
  });
});
