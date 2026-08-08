import { afterEach, describe, expect, it, vi } from 'vitest';
import { canAccessMetrics } from '../../supabase/functions/_shared/metrics-access.ts';

/**
 * See supabase/functions/_shared/metrics-access.test.ts for the full unit
 * suite. This file states the security property as a single readable spec:
 * fail-closed, never "any authenticated user" when misconfigured. This was
 * a real production bug fixed during this project (a stale duplicate test
 * previously asserted the opposite, fail-open, behavior — see git history
 * of supabase/functions/_shared/auth.ts).
 */

function setEnv(value: string | undefined) {
  vi.stubGlobal('Deno', { env: { get: () => value } });
}

describe('security: metrics dashboard authorization (fail-closed)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('admin → allow', () => {
    setEnv('admin@priceguard.ai');
    expect(canAccessMetrics('admin@priceguard.ai')).toBe(true);
  });

  it('non-admin → deny', () => {
    setEnv('admin@priceguard.ai');
    expect(canAccessMetrics('someone-else@example.com')).toBe(false);
  });

  it('missing env (unset) → deny, NEVER "any authenticated user"', () => {
    setEnv(undefined);
    expect(canAccessMetrics('literally-anyone@example.com')).toBe(false);
  });

  it('malformed env (empty / whitespace-only) → deny', () => {
    setEnv('   ');
    expect(canAccessMetrics('anyone@example.com')).toBe(false);
    setEnv('');
    expect(canAccessMetrics('anyone@example.com')).toBe(false);
  });
});
