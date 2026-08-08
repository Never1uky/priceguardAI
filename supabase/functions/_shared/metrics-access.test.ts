import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Tests the REAL implementation, imported directly from the pure
 * dependency-free module (not auth.ts, which pulls in a live createClient
 * from esm.sh at module load time and can't be imported under vitest/Node).
 *
 * Previously src/lib/supabase/metrics-access.test.ts redefined this logic
 * as a local hand-copied duplicate and asserted the OLD fail-open behavior
 * (`list.length === 0 → true`) as correct. That file has been removed;
 * this replaces it, testing the actual production function.
 */
import { canAccessMetrics } from './metrics-access.ts';

const ENV_KEY = 'METRICS_ADMIN_EMAILS';

function setEnv(value: string | undefined) {
  vi.stubGlobal('Deno', {
    env: {
      get: (key: string) => (key === ENV_KEY ? value : undefined),
    },
  });
}

describe('canAccessMetrics (fail-closed authorization)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('admin email in allowlist → allow', () => {
    setEnv('admin@priceguard.ai, other-admin@priceguard.ai');
    expect(canAccessMetrics('admin@priceguard.ai')).toBe(true);
  });

  it('allowlist matching is case-insensitive', () => {
    setEnv('Admin@PriceGuard.ai');
    expect(canAccessMetrics('admin@priceguard.ai')).toBe(true);
  });

  it('non-admin email, allowlist configured → deny', () => {
    setEnv('admin@priceguard.ai');
    expect(canAccessMetrics('random-user@example.com')).toBe(false);
  });

  it('missing METRICS_ADMIN_EMAILS entirely (undefined) → deny, never fail-open', () => {
    setEnv(undefined);
    expect(canAccessMetrics('anyone@example.com')).toBe(false);
    expect(canAccessMetrics(undefined)).toBe(false);
  });

  it('empty string METRICS_ADMIN_EMAILS → deny', () => {
    setEnv('');
    expect(canAccessMetrics('anyone@example.com')).toBe(false);
  });

  it('malformed env (only commas/whitespace, no real emails) → deny', () => {
    setEnv(' , , ,  ');
    expect(canAccessMetrics('anyone@example.com')).toBe(false);
  });

  it('allowlist configured but caller has no email → deny', () => {
    setEnv('admin@priceguard.ai');
    expect(canAccessMetrics(undefined)).toBe(false);
  });
});
