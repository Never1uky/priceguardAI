import { describe, expect, it } from 'vitest';

/** Логика canAccessMetrics (дублирует edge _shared/auth.ts) */
function canAccessMetrics(email: string | undefined, adminEmailsEnv: string): boolean {
  const list = adminEmailsEnv
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (list.length === 0) return true;
  if (!email) return false;
  return list.includes(email.toLowerCase());
}

describe('canAccessMetrics', () => {
  it('пустой METRICS_ADMIN_EMAILS — доступ всем', () => {
    expect(canAccessMetrics('any@test.com', '')).toBe(true);
    expect(canAccessMetrics(undefined, '  ')).toBe(true);
  });

  it('список задан — только указанные email', () => {
    expect(canAccessMetrics('admin@test.com', 'admin@test.com,other@test.com')).toBe(true);
    expect(canAccessMetrics('stranger@test.com', 'admin@test.com')).toBe(false);
  });
});
