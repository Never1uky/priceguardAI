import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AGENT_MAX_COST_RUB,
  AGENT_MAX_PRODUCTS_AFTER_FILTER,
  AGENT_MAX_PRODUCTS_BEFORE_FILTER,
  AGENT_MAX_SEARCHES,
  AGENT_MAX_STEPS,
  AGENT_RUNTIME_BUDGET_MS,
  DEFAULT_AGENT_DAILY_CAP,
  isAgentDailyCapped,
  isAgentDailyCountCapped,
  shouldContinueAgentLoop,
  shouldStopByAgentRuntimeBudget,
  type AgentBudgetCountClient,
} from './agent-budget.ts';

function mockCountClient(result: {
  count: number | null;
  error?: unknown;
}): AgentBudgetCountClient {
  const gte = vi.fn().mockResolvedValue(result);
  const eq = vi.fn().mockReturnValue({ gte });
  const select = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ select });
  return { from } as unknown as AgentBudgetCountClient;
}

describe('agent-budget', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('exports loop / cost / daily-cap constants in the planned range', () => {
    expect(AGENT_MAX_STEPS).toBe(6);
    expect(AGENT_MAX_SEARCHES).toBe(3);
    expect(AGENT_MAX_PRODUCTS_BEFORE_FILTER).toBe(30);
    expect(AGENT_MAX_PRODUCTS_AFTER_FILTER).toBe(10);
    expect(AGENT_MAX_COST_RUB).toBe(1.0);
    expect(AGENT_RUNTIME_BUDGET_MS).toBe(45_000);
    expect(DEFAULT_AGENT_DAILY_CAP).toBe(5);
    expect(AGENT_MAX_PRODUCTS_AFTER_FILTER).toBeLessThan(AGENT_MAX_PRODUCTS_BEFORE_FILTER);
  });

  describe('shouldContinueAgentLoop', () => {
    it('continues under all limits', () => {
      expect(
        shouldContinueAgentLoop({ stepsTaken: 0, searchesUsed: 0, costSoFarRub: 0 }),
      ).toEqual({ action: 'continue' });
      expect(
        shouldContinueAgentLoop({
          stepsTaken: AGENT_MAX_STEPS - 1,
          searchesUsed: AGENT_MAX_SEARCHES - 1,
          costSoFarRub: AGENT_MAX_COST_RUB - 0.01,
        }),
      ).toEqual({ action: 'continue' });
    });

    it('stops at max_steps before other reasons', () => {
      expect(
        shouldContinueAgentLoop({
          stepsTaken: AGENT_MAX_STEPS,
          searchesUsed: AGENT_MAX_SEARCHES,
          costSoFarRub: AGENT_MAX_COST_RUB,
        }),
      ).toEqual({ action: 'stop', reason: 'max_steps' });
    });

    it('stops at max_searches when steps remain', () => {
      expect(
        shouldContinueAgentLoop({
          stepsTaken: 2,
          searchesUsed: AGENT_MAX_SEARCHES,
          costSoFarRub: 0.1,
        }),
      ).toEqual({ action: 'stop', reason: 'max_searches' });
    });

    it('stops at max_cost when steps and searches remain', () => {
      expect(
        shouldContinueAgentLoop({
          stepsTaken: 1,
          searchesUsed: 1,
          costSoFarRub: AGENT_MAX_COST_RUB,
        }),
      ).toEqual({ action: 'stop', reason: 'max_cost' });
    });
  });

  describe('shouldStopByAgentRuntimeBudget', () => {
    it('stops only after the default 45s budget', () => {
      const started = 1_000_000;
      expect(shouldStopByAgentRuntimeBudget(started, started + 1_000)).toBe(false);
      expect(
        shouldStopByAgentRuntimeBudget(started, started + AGENT_RUNTIME_BUDGET_MS),
      ).toBe(true);
    });

    it('honours an explicit budgetMs', () => {
      expect(shouldStopByAgentRuntimeBudget(0, 10, 20)).toBe(false);
      expect(shouldStopByAgentRuntimeBudget(0, 20, 20)).toBe(true);
    });
  });

  describe('isAgentDailyCapped', () => {
    it('treats count >= cap as capped (pure helper)', () => {
      expect(isAgentDailyCountCapped(4, 5)).toBe(false);
      expect(isAgentDailyCountCapped(5, 5)).toBe(true);
      expect(isAgentDailyCountCapped(6, 5)).toBe(true);
      expect(isAgentDailyCountCapped(null, 5)).toBe(false);
      expect(isAgentDailyCountCapped(10, 0)).toBe(false);
    });

    it('returns false without a userId (fail open)', async () => {
      const client = mockCountClient({ count: 99 });
      expect(await isAgentDailyCapped(client, null)).toBe(false);
      expect(await isAgentDailyCapped(client, '')).toBe(false);
      expect(client.from).not.toHaveBeenCalled();
    });

    it('queries agent_searches since UTC midnight and caps at DEFAULT_AGENT_DAILY_CAP', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-08-17T15:30:00.000Z'));
      const client = mockCountClient({ count: 5 });

      expect(await isAgentDailyCapped(client, 'user-1')).toBe(true);
      expect(client.from).toHaveBeenCalledWith('agent_searches');

      const from = client.from as unknown as ReturnType<typeof vi.fn>;
      const select = from.mock.results[0].value.select as ReturnType<typeof vi.fn>;
      expect(select).toHaveBeenCalledWith('id', { count: 'exact', head: true });
      const eq = select.mock.results[0].value.eq as ReturnType<typeof vi.fn>;
      expect(eq).toHaveBeenCalledWith('user_id', 'user-1');
      const gte = eq.mock.results[0].value.gte as ReturnType<typeof vi.fn>;
      expect(gte).toHaveBeenCalledWith('created_at', '2026-08-17T00:00:00.000Z');

      vi.useRealTimers();
    });

    it('is not capped below the daily limit', async () => {
      const client = mockCountClient({ count: 4 });
      expect(await isAgentDailyCapped(client, 'user-1', DEFAULT_AGENT_DAILY_CAP)).toBe(false);
    });

    it('fail-open on query error', async () => {
      const client = mockCountClient({ count: 99, error: new Error('db down') });
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      expect(await isAgentDailyCapped(client, 'user-1')).toBe(false);
      expect(errorSpy).toHaveBeenCalled();
    });
  });
});
