import { describe, expect, it } from 'vitest';
import { DEVELOPER_EMAIL, isDeveloperEmail } from '@/lib/developer-access';

describe('developer-access', () => {
  it('recognizes developer email case-insensitively', () => {
    expect(isDeveloperEmail(DEVELOPER_EMAIL)).toBe(true);
    expect(isDeveloperEmail('Gorum55@Gmail.com')).toBe(true);
    expect(isDeveloperEmail('other@test.com')).toBe(false);
    expect(isDeveloperEmail(undefined)).toBe(false);
  });
});
