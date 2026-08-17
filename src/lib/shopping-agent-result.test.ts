import { describe, expect, it } from 'vitest';
import { EdgeError } from '@/lib/supabase/edge';
import {
  AGENT_DAILY_CAP_USER_MESSAGE,
  AGENT_STATUS_LABELS,
  agentStatusLabel,
  agentSubmitErrorMessage,
  joinAgentOffers,
  parseAgentSearchResult,
  type AgentSearchResult,
} from '@/lib/shopping-agent-result';

const matched = {
  title: 'Google Pixel 8 128 ГБ',
  url: 'https://www.wildberries.ru/catalog/123/detail.aspx',
  price: 49990,
  matchConfidence: 80,
  marketplace: 'wildberries' as const,
  productId: '123',
  matches: true,
  reason: 'совпадает модель',
};

function sampleResult(over: Partial<AgentSearchResult> = {}): AgentSearchResult {
  return {
    searchId: 's1',
    status: 'done',
    summary: 'Беру Pixel 8 — в бюджете и тише аналогов.',
    ranked: [{ productId: '123', score: 9, reason: 'лучший баланс' }],
    matched: [matched],
    disclosure: false,
    stepsTaken: 4,
    searchesUsed: 1,
    costEstimateRub: 0.2,
    ...over,
  };
}

describe('agentStatusLabel', () => {
  it('maps in-progress statuses to Russian copy', () => {
    expect(agentStatusLabel('pending')).toBe('Готовим запрос');
    expect(agentStatusLabel('searching')).toBe('Ищем на WB, Ozon и Маркете');
    expect(agentStatusLabel('evaluating')).toBe('Отбираем подходящие');
    expect(agentStatusLabel('ranking')).toBe('Составляем рекомендацию');
    expect(AGENT_STATUS_LABELS.done).toBe('Готово');
    expect(AGENT_STATUS_LABELS.failed).toBe('Не удалось подобрать');
  });
});

describe('parseAgentSearchResult', () => {
  it('accepts a valid Edge jsonb payload', () => {
    expect(parseAgentSearchResult(sampleResult())).toEqual(sampleResult());
  });

  it('rejects missing status/summary/arrays', () => {
    expect(parseAgentSearchResult(null)).toBeNull();
    expect(parseAgentSearchResult({ status: 'done' })).toBeNull();
    expect(parseAgentSearchResult({ status: 'done', summary: 'x', ranked: [], matched: 'no' })).toBeNull();
  });

  it('drops invalid ranked/matched rows and keeps valid ones', () => {
    const parsed = parseAgentSearchResult({
      ...sampleResult(),
      ranked: [{ productId: '123', score: 8, reason: 'ok' }, { score: 1 }, null],
      matched: [matched, { title: 'x' }, { title: 'Ozon', url: 'https://www.ozon.ru/product/1', marketplace: 'ozon' }],
    });
    expect(parsed?.ranked).toHaveLength(1);
    expect(parsed?.matched).toHaveLength(2);
    expect(parsed?.matched[1]?.marketplace).toBe('ozon');
  });
});

describe('joinAgentOffers', () => {
  it('follows ranked order and attaches score/reason', () => {
    const ozon = {
      ...matched,
      title: 'Pixel 8 Ozon',
      url: 'https://www.ozon.ru/product/pixel-8-999',
      marketplace: 'ozon' as const,
      productId: '999',
    };
    const rows = joinAgentOffers(
      sampleResult({
        ranked: [
          { productId: '999', score: 8, reason: 'дешевле' },
          { productId: '123', score: 7, reason: 'знакомая модель' },
        ],
        matched: [matched, ozon],
      }),
    );
    expect(rows.map((r) => r.productId)).toEqual(['999', '123']);
    expect(rows[0]?.rankReason).toBe('дешевле');
    expect(rows[0]?.score).toBe(8);
  });

  it('falls back to matched when ranked is empty', () => {
    const rows = joinAgentOffers(sampleResult({ ranked: [] }));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.title).toBe(matched.title);
    expect(rows[0]?.score).toBeUndefined();
  });
});

describe('agentSubmitErrorMessage', () => {
  it('maps agent_daily_cap to the user-facing daily limit copy', () => {
    expect(
      agentSubmitErrorMessage(new EdgeError('raw', 429, 'agent_daily_cap')),
    ).toBe(AGENT_DAILY_CAP_USER_MESSAGE);
  });
});
