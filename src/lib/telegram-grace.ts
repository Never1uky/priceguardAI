/**
 * Skip Telegram for freshly tracked «Мои товары» — Chrome notification is enough.
 * Real drops after the grace window still go to Telegram.
 */

export const TELEGRAM_ALERT_GRACE_MS = 6 * 60 * 60 * 1000;

export function isWithinTelegramGrace(
  trackedAt: number | null | undefined,
  now = Date.now(),
): boolean {
  if (trackedAt == null || !Number.isFinite(trackedAt) || trackedAt <= 0) return false;
  const age = now - trackedAt;
  return age >= 0 && age < TELEGRAM_ALERT_GRACE_MS;
}

export function isWithinTelegramGraceIso(
  createdAt: string | null | undefined,
  now = Date.now(),
): boolean {
  if (!createdAt) return false;
  const t = Date.parse(createdAt);
  if (!Number.isFinite(t)) return false;
  return isWithinTelegramGrace(t, now);
}

export function logTelegramGraceSkip(productId: string, trackedAt: number, now = Date.now()): void {
  console.info('[PriceGuard] telegram grace skip', {
    productId,
    ageMs: now - trackedAt,
  });
}
