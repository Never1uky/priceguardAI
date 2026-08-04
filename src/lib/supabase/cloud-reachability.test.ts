import { describe, expect, it } from 'vitest';
import { isCloudNetworkError } from '@/lib/supabase/cloud-reachability';

describe('isCloudNetworkError', () => {
  it('detects Failed to fetch / DNS', () => {
    expect(isCloudNetworkError(new TypeError('Failed to fetch'))).toBe(true);
    expect(isCloudNetworkError('net::ERR_NAME_NOT_RESOLVED')).toBe(true);
    expect(isCloudNetworkError('Edge timeout')).toBe(false);
  });
});
