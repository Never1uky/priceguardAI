import { describe, expect, it } from 'vitest';
import { shouldReportExtensionError } from '@/lib/support-report';

describe('shouldReportExtensionError', () => {
  it('skips Invalid login credentials', () => {
    expect(shouldReportExtensionError('Invalid login credentials')).toBe(false);
  });

  it('skips Russian auth and free-limit UX', () => {
    expect(shouldReportExtensionError('Неверный email или пароль')).toBe(false);
    expect(shouldReportExtensionError('Лимит бесплатной версии: 5 товаров. Оформите Premium.')).toBe(
      false,
    );
  });

  it('reports unexpected errors', () => {
    expect(shouldReportExtensionError('Cannot read properties of undefined')).toBe(true);
    expect(shouldReportExtensionError('Edge function 500')).toBe(true);
  });
});
