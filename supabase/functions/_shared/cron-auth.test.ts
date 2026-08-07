import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  authorizeCronOrServiceRole,
  authorizeCronOrServiceRoleDetailed,
} from './cron-auth.ts';

function stubDenoEnv(values: Record<string, string | undefined>) {
  vi.stubGlobal('Deno', {
    env: {
      get: (key: string) => values[key],
    },
  });
}

describe('cron auth', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('authorizes by x-cron-secret', () => {
    stubDenoEnv({
      UPDATE_PRICES_CRON_SECRET: 'cron-secret',
      SUPABASE_SERVICE_ROLE_KEY: 'service-key',
    });
    const req = new Request('https://example.test', {
      method: 'POST',
      headers: { 'x-cron-secret': 'cron-secret' },
    });
    expect(authorizeCronOrServiceRole(req)).toBe(true);
    expect(authorizeCronOrServiceRoleDetailed(req).reason).toBe('ok_cron_secret');
  });

  it('authorizes by service role bearer', () => {
    stubDenoEnv({
      UPDATE_PRICES_CRON_SECRET: 'cron-secret',
      SUPABASE_SERVICE_ROLE_KEY: 'service-key',
    });
    const req = new Request('https://example.test', {
      method: 'POST',
      headers: { Authorization: 'Bearer service-key' },
    });
    const result = authorizeCronOrServiceRoleDetailed(req);
    expect(result.ok).toBe(true);
    expect(result.reason).toBe('ok_service_role');
  });

  it('authorizes legacy service_role JWT when Edge has sb_secret', () => {
    stubDenoEnv({
      UPDATE_PRICES_CRON_SECRET: 'cron-secret',
      SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_abc',
      SUPABASE_URL: 'https://ihlfvpocwobvcpxbypsd.supabase.co',
    });
    // header.payload.sig — payload role=service_role, ref=ihlfvpocwobvcpxbypsd
    const payload = btoa(
      JSON.stringify({ role: 'service_role', ref: 'ihlfvpocwobvcpxbypsd' }),
    )
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
    const token = `eyJhbGciOiJIUzI1NiJ9.${payload}.sig`;
    const req = new Request('https://example.test', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    const result = authorizeCronOrServiceRoleDetailed(req);
    expect(result.ok).toBe(true);
    expect(result.reason).toBe('ok_service_role_jwt');
  });

  it('returns invalid cron secret reason', () => {
    stubDenoEnv({
      UPDATE_PRICES_CRON_SECRET: 'cron-secret',
      SUPABASE_SERVICE_ROLE_KEY: 'service-key',
    });
    const req = new Request('https://example.test', {
      method: 'POST',
      headers: { 'x-cron-secret': 'wrong' },
    });
    const result = authorizeCronOrServiceRoleDetailed(req);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('invalid_cron_secret');
  });

  it('returns missing credentials reason', () => {
    stubDenoEnv({
      UPDATE_PRICES_CRON_SECRET: 'cron-secret',
      SUPABASE_SERVICE_ROLE_KEY: 'service-key',
    });
    const req = new Request('https://example.test', { method: 'POST' });
    const result = authorizeCronOrServiceRoleDetailed(req);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('missing_both_credentials');
  });
});
