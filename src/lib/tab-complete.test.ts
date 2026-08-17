import { afterEach, describe, expect, it, vi } from 'vitest';
import { isTabLoadTimeoutError, waitForTabComplete } from '@/lib/tab-complete';

describe('waitForTabComplete', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('resolves immediately when the tab is already complete', async () => {
    const onUpdated = { addListener: vi.fn(), removeListener: vi.fn() };
    vi.stubGlobal('chrome', {
      tabs: {
        get: vi.fn().mockResolvedValue({ id: 7, status: 'complete' }),
        onUpdated,
      },
    });

    await expect(waitForTabComplete(7, 1_000, 'Страница поиска не загрузилась')).resolves.toBeUndefined();
    expect(onUpdated.addListener).not.toHaveBeenCalled();
  });

  it('does not reject as timeout when complete is already set', async () => {
    vi.stubGlobal('chrome', {
      tabs: {
        get: vi.fn().mockResolvedValue({ id: 3, status: 'complete' }),
        onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
      },
    });

    await waitForTabComplete(3, 50);
    expect(true).toBe(true);
  });
});

describe('isTabLoadTimeoutError', () => {
  it('detects load-timeout messages', () => {
    expect(isTabLoadTimeoutError(new Error('Страница поиска не загрузилась'))).toBe(true);
    expect(isTabLoadTimeoutError(new Error('Страница не загрузилась'))).toBe(true);
    expect(isTabLoadTimeoutError(new Error('empty serp'))).toBe(false);
  });
});
