import { describe, expect, it } from 'vitest';
import { resolveAddToMyProductsResult } from '@/lib/add-to-my-products-result';

describe('resolveAddToMyProductsResult', () => {
  it('track ok + ENSURE fail → partial, not fail', () => {
    const r = resolveAddToMyProductsResult({
      alreadyPresent: false,
      wantResearch: true,
      ensureOk: false,
      ensureError: 'Не удалось добавить в «Мои товары»',
      ensureStarted: false,
      inTracked: true,
      inCompare: false,
    });
    expect(r.kind).toBe('partial');
    expect(r.message).toMatch(/Поиск цен не запустился/i);
  });

  it('ENSURE throw equivalent: in list without ensure ok → partial or ok', () => {
    const r = resolveAddToMyProductsResult({
      wantResearch: true,
      ensureOk: null,
      ensureError: 'Extension context invalidated',
      inTracked: true,
      inCompare: false,
    });
    expect(r.kind).not.toBe('fail');
    expect(['ok', 'partial']).toContain(r.kind);
  });

  it('in compare + research started → ok', () => {
    const r = resolveAddToMyProductsResult({
      alreadyPresent: false,
      wantResearch: true,
      ensureOk: true,
      ensureStarted: true,
      inTracked: true,
      inCompare: true,
      compareId: 'c1',
    });
    expect(r.kind).toBe('ok');
    expect(r.message).toMatch(/ищем цены/i);
    expect(r.researchStarted).toBe(true);
  });

  it('wantResearch but ensureStarted false → partial, researchStarted false', () => {
    const r = resolveAddToMyProductsResult({
      alreadyPresent: false,
      wantResearch: true,
      ensureOk: true,
      ensureStarted: false,
      inTracked: true,
      inCompare: true,
      compareId: 'c1',
    });
    expect(r.kind).toBe('partial');
    expect(r.researchStarted).toBe(false);
    expect(r.message).toMatch(/не запустился|Найти заново/i);
  });

  it('nowhere + limit error → limit', () => {
    const r = resolveAddToMyProductsResult({
      ensureOk: false,
      ensureError: 'Лимит бесплатной версии: 5 товаров',
      inTracked: false,
      inCompare: false,
    });
    expect(r.kind).toBe('limit');
  });

  it('nowhere + generic error → fail', () => {
    const r = resolveAddToMyProductsResult({
      ensureOk: false,
      ensureError: 'Сеть недоступна',
      inTracked: false,
      inCompare: false,
    });
    expect(r.kind).toBe('fail');
    expect(r.message).toContain('Сеть');
  });

  it('ensure ok alone without storage presence → fail (no false success)', () => {
    const r = resolveAddToMyProductsResult({
      ensureOk: true,
      ensureStarted: true,
      inTracked: false,
      inCompare: false,
    });
    expect(r.kind).toBe('fail');
  });

  it('already present open → ok short message', () => {
    const r = resolveAddToMyProductsResult({
      alreadyPresent: true,
      wantResearch: false,
      ensureOk: true,
      inTracked: true,
      inCompare: true,
      compareId: 'c1',
    });
    expect(r.kind).toBe('ok');
    expect(r.message).toMatch(/Открыто|Товар в/i);
  });
});
