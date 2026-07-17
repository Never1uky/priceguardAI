import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/config', () => ({
  getSupabaseConfig: () => ({ configured: true, url: 'https://x.supabase.co', anonKey: 'key' }),
}));

vi.mock('@/lib/supabase/auth', () => ({
  isAuthenticated: vi.fn(),
  getAccessToken: vi.fn(),
  getAuthUser: vi.fn(),
}));

import { isAuthenticated, getAuthUser } from '@/lib/supabase/auth';
import { canUseCloudFeatures, withAuthenticatedUser } from '@/lib/supabase/auth-guard';

describe('auth-guard', () => {
  beforeEach(() => {
    vi.mocked(isAuthenticated).mockReset();
    vi.mocked(getAuthUser).mockReset();
  });

  it('canUseCloudFeatures returns false when not authenticated', async () => {
    vi.mocked(isAuthenticated).mockResolvedValue(false);
    await expect(canUseCloudFeatures()).resolves.toBe(false);
  });

  it('canUseCloudFeatures returns true when authenticated', async () => {
    vi.mocked(isAuthenticated).mockResolvedValue(true);
    await expect(canUseCloudFeatures()).resolves.toBe(true);
  });

  it('withAuthenticatedUser runs fn with user id', async () => {
    vi.mocked(getAuthUser).mockResolvedValue({ id: 'user-1' } as never);
    const result = await withAuthenticatedUser(async (id) => `ok:${id}`, null);
    expect(result).toBe('ok:user-1');
  });

  it('withAuthenticatedUser returns fallback when logged out', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(null);
    const result = await withAuthenticatedUser(async () => 'ok', 'fallback');
    expect(result).toBe('fallback');
  });
});
