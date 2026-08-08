import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fetchYookassaPayment } from '../../supabase/functions/_shared/yookassa-verify.ts';

/**
 * Security tests for the actual current implementation (not the sandbox
 * version discussed earlier in this project's history — this repo's real
 * yookassa-verify.ts has a single fetchYookassaPayment(paymentId) that reads
 * Deno.env and calls global fetch directly, no dependency injection).
 *
 * The comparison/idempotency decisions (status/amount/currency/repeat-webhook)
 * all live inline inside yookassa-webhook/index.ts's Deno.serve handler, which
 * imports createClient from esm.sh at module scope and therefore cannot be
 * imported under vitest/Node (same constraint hit throughout this project —
 * see docs/audits/YOOKASSA_REMEDIATION_PLAN.md). Rather than fake coverage,
 * these are honest regression guards: they read the real source and assert
 * the specific checks are present, so removing any of them fails CI.
 */

function stubDenoEnv(vars: Record<string, string>) {
  vi.stubGlobal('Deno', { env: { get: (k: string) => vars[k] } });
}

describe('security: fetchYookassaPayment (real API call boundary)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns null (never throws, never fabricates a payment) if shop credentials are missing', async () => {
    stubDenoEnv({});
    vi.stubGlobal('fetch', vi.fn());
    const result = await fetchYookassaPayment('pay_1');
    expect(result).toBeNull();
  });

  it('returns null on a non-ok API response (e.g. 404 for a forged/invalid payment id)', async () => {
    stubDenoEnv({ YOOKASSA_SHOP_ID: 'shop', YOOKASSA_SECRET_KEY: 'secret' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not found', { status: 404 })));
    const result = await fetchYookassaPayment('does-not-exist');
    expect(result).toBeNull();
  });

  it('parses a legitimate succeeded payment correctly, including session_id from metadata', async () => {
    stubDenoEnv({ YOOKASSA_SHOP_ID: 'shop', YOOKASSA_SECRET_KEY: 'secret' });
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://api.yookassa.ru/v3/payments/pay_1');
      expect((init.headers as Record<string, string>).Authorization).toMatch(/^Basic /);
      return new Response(
        JSON.stringify({
          id: 'pay_1',
          status: 'succeeded',
          amount: { value: '299.00', currency: 'RUB' },
          metadata: { session_id: 'sess_abc' },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await fetchYookassaPayment('pay_1');
    expect(result).toEqual({
      id: 'pay_1',
      status: 'succeeded',
      amountValue: 299,
      currency: 'RUB',
      sessionId: 'sess_abc',
      metadata: { session_id: 'sess_abc' },
    });
  });

  it('a pending payment is reported as pending, never coerced to succeeded', async () => {
    stubDenoEnv({ YOOKASSA_SHOP_ID: 'shop', YOOKASSA_SECRET_KEY: 'secret' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({ id: 'pay_2', status: 'pending', amount: { value: '299.00', currency: 'RUB' } }),
          { status: 200 },
        ),
      ),
    );
    const result = await fetchYookassaPayment('pay_2');
    expect(result?.status).toBe('pending');
  });
});

describe('security: yookassa-webhook decision logic (source regression guard)', () => {
  it('contains all required checks: status, currency, amount, idempotency, and user-from-DB-not-body', async () => {
    const source = await fs.readFile(
      path.resolve(__dirname, '../../supabase/functions/yookassa-webhook/index.ts'),
      'utf-8',
    );

    // Never trusts the webhook body directly for the success decision.
    expect(source).toMatch(/fetchYookassaPayment\(yookassaId\)/);
    expect(source).toMatch(/Never trust webhook body/i);

    // status == succeeded (forged/pending webhook rejection)
    expect(source).toMatch(/verified\.status\s*!==\s*'succeeded'/);

    // currency == expected (wrong currency rejection)
    expect(source).toMatch(/verified\.currency\s*!==\s*'RUB'/);

    // amount == expected (wrong amount rejection) — checked against both the
    // stored row AND the server-side PLAN_PRICES constant, not client input.
    expect(source).toMatch(/expectedRub/);
    expect(source).toMatch(/PLAN_PRICES\[paymentRow\.plan/);

    // user/order matches — user_id is read from OUR OWN payments row, never
    // from the webhook body (the "wrong user" attack).
    expect(source).not.toMatch(/paymentHint\?\.\s*user_id/);
    expect(source).not.toMatch(/body\s*\.\s*user_id/);
    expect(source).toMatch(/paymentRow\.user_id/);

    // idempotency — repeated webhook for an already-succeeded payment must
    // not mint a second license.
    expect(source).toMatch(
      /paymentRow\.status === 'succeeded' && paymentRow\.license_key_id/,
    );
    expect(source).toMatch(/alreadyProcessed:\s*true/);

    // invalid payment (verification failure) is rejected, not treated as success.
    expect(source).toMatch(/if \(!verified\)/);
  });
});
