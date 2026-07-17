import { describe, expect, it } from 'vitest';
import { FREE_DAILY_AI_LIMIT } from '@/lib/api/ai-quota';

describe('ai-quota constants', () => {
  it('free daily limit is 3', () => {
    expect(FREE_DAILY_AI_LIMIT).toBe(3);
  });
});
