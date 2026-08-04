import { describe, expect, it } from 'vitest';
import {
  canStartTrackedCloudSync,
  shouldIgnoreRealtimeEvent,
} from '@/lib/supabase/tracked-realtime';

describe('tracked-realtime guards', () => {
  it('shouldIgnoreRealtimeEvent inside quiet window', () => {
    expect(shouldIgnoreRealtimeEvent(1000, 2000)).toBe(true);
    expect(shouldIgnoreRealtimeEvent(2000, 2000)).toBe(false);
    expect(shouldIgnoreRealtimeEvent(2500, 2000)).toBe(false);
  });

  it('canStartTrackedCloudSync blocks in-flight and cooldown', () => {
    expect(canStartTrackedCloudSync(5000, true, 1000, 3000)).toBe(false);
    expect(canStartTrackedCloudSync(5000, false, 4000, 3000)).toBe(false);
    expect(canStartTrackedCloudSync(5000, false, 1000, 3000)).toBe(true);
    expect(canStartTrackedCloudSync(1000, false, 0, 3000)).toBe(true);
  });
});
