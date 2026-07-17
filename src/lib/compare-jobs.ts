import { checkComparePriceDrops } from '@/lib/compare-price-alerts';
import { refreshCompareProduct } from '@/lib/compare-service';
import { updateCompareProduct } from '@/lib/comparison-storage';
import type { CompareProduct } from '@/types/comparison';

const RUNNING_KEY = 'priceguard_compare_running';
const RUNNING_AT_KEY = 'priceguard_compare_running_at';
export const SEARCHING_MP_KEY = 'priceguard_compare_searching_mp';
/** Идёт параллельный поиск на нескольких площадках (не источник) */
export const SEARCHING_MP_CROSS = 'cross' as const;
export type SearchingMarketplaceKey = import('@/types/comparison').ComparisonMarketplace | typeof SEARCHING_MP_CROSS;
/** Если фоновая задача зависла (SW перезапустился) — разблокировать кнопку */
const RUNNING_STALE_MS = 4 * 60 * 1000;

let keepAliveTimer: ReturnType<typeof setInterval> | null = null;

function startKeepAlive(): void {
  if (keepAliveTimer) return;
  keepAliveTimer = setInterval(() => {
    chrome.runtime.getPlatformInfo(() => {});
  }, 20_000);
}

function stopKeepAlive(): void {
  if (keepAliveTimer) {
    clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  }
}

export async function getRunningCompareProductId(): Promise<string | null> {
  const stored = await chrome.storage.local.get([RUNNING_KEY, RUNNING_AT_KEY]);
  const id = stored[RUNNING_KEY];
  const startedAt = stored[RUNNING_AT_KEY] as number | undefined;

  if (typeof id !== 'string' || !id.length) return null;

  if (startedAt && Date.now() - startedAt > RUNNING_STALE_MS) {
    await clearCompareRunning();
    return null;
  }

  return id;
}

export async function isCompareRunning(productId: string): Promise<boolean> {
  const running = await getRunningCompareProductId();
  return running === productId;
}

export async function clearCompareRunning(): Promise<void> {
  await chrome.storage.local.remove([RUNNING_KEY, RUNNING_AT_KEY, SEARCHING_MP_KEY]);
}

async function setCompareRunning(productId: string | null): Promise<void> {
  if (productId) {
    await chrome.storage.local.set({
      [RUNNING_KEY]: productId,
      [RUNNING_AT_KEY]: Date.now(),
    });
  } else {
    await clearCompareRunning();
  }
}

/** Запуск сравнения в фоне — не зависит от открытого popup. */
export async function runCompareJob(
  product: CompareProduct,
  force = true,
  mode: 'refresh' | 'research' = 'refresh',
): Promise<void> {
  const running = await getRunningCompareProductId();

  if (running && running !== product.id && !force) return;

  if (running && force) {
    await clearCompareRunning();
  } else if (running === product.id && !force) {
    return;
  }

  await setCompareRunning(product.id);
  startKeepAlive();

  try {
    const result = await refreshCompareProduct(product, force, {
      mode,
      onProgress: async (updated) => {
        await updateCompareProduct(updated);
      },
    });

    await checkComparePriceDrops(product, result.offers);
  } catch (error) {
    console.warn('[PriceGuard] compare job:', error);
  } finally {
    await setCompareRunning(null);
    stopKeepAlive();
  }
}
