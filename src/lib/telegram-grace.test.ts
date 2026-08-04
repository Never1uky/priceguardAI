import { describe, expect, it } from 'vitest';
import {
  isWithinTelegramGrace,
  isWithinTelegramGraceIso,
  TELEGRAM_ALERT_GRACE_MS,
} from '@/lib/telegram-grace';

describe('telegram-grace', () => {
  it('skips TG within grace window', () => {
    const now = 1_700_000_000_000;
    expect(isWithinTelegramGrace(now - 60_000, now)).toBe(true);
    expect(isWithinTelegramGrace(now - TELEGRAM_ALERT_GRACE_MS + 1, now)).toBe(true);
  });

  it('allows TG after grace', () => {
    const now = 1_700_000_000_000;
    expect(isWithinTelegramGrace(now - TELEGRAM_ALERT_GRACE_MS - 1, now)).toBe(false);
    expect(isWithinTelegramGrace(undefined, now)).toBe(false);
  });

  it('parses ISO created_at', () => {
    const now = Date.parse('2026-07-18T12:00:00.000Z');
    expect(isWithinTelegramGraceIso('2026-07-18T10:00:00.000Z', now)).toBe(true);
    expect(isWithinTelegramGraceIso('2026-07-17T12:00:00.000Z', now)).toBe(false);
  });
});
