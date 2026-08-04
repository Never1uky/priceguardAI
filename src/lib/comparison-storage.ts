import type { CompareProduct } from '@/types/comparison';
import {
  findDuplicateCompareProduct,
  mergeCompareProducts,
} from '@/lib/compare-merge';
import { hydrateCompareImages } from '@/lib/product-image';
import { markCompareDeleted, getCompareDeletedIds, syncCompareProductsWithCloud } from '@/lib/supabase/compare-sync';

const STORAGE_KEY = 'priceguard_compare_products';
const SELECTED_KEY = 'priceguard_compare_selected_id';

function isValidCompareProduct(item: unknown): item is CompareProduct {
  if (!item || typeof item !== 'object') return false;
  const p = item as CompareProduct;
  return Boolean(p.id && p.title && p.sourceUrl && p.sourceMarketplace);
}

function consolidateCompareProducts(products: CompareProduct[]): CompareProduct[] {
  const result: CompareProduct[] = [];

  for (const product of products) {
    const duplicate = findDuplicateCompareProduct(result, product);
    if (duplicate) {
      const index = result.findIndex((p) => p.id === duplicate.id);
      result[index] = mergeCompareProducts(result[index], product);
    } else {
      result.push(product);
    }
  }

  return result;
}

export async function getCompareProducts(): Promise<CompareProduct[]> {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const list = (stored[STORAGE_KEY] as unknown[] | undefined) ?? [];
  const valid = list.filter(isValidCompareProduct);
  const consolidated = consolidateCompareProducts(valid);

  if (consolidated.length !== valid.length) {
    await saveCompareProductsLocal(consolidated);
  }

  return consolidated;
}

/** Local-only write (no cloud debounce) — used during consolidate. */
async function saveCompareProductsLocal(products: CompareProduct[]): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: products });
}

export async function saveCompareProducts(products: CompareProduct[]): Promise<void> {
  await saveCompareProductsLocal(products);
  void pushCompareToCloudSoon();
}

let compareSyncTimer: ReturnType<typeof setTimeout> | null = null;

function pushCompareToCloudSoon(): void {
  if (compareSyncTimer) clearTimeout(compareSyncTimer);
  compareSyncTimer = setTimeout(() => {
    void syncCompareProductsWithCloudDebounced();
  }, 1_500);
}

async function syncCompareProductsWithCloudDebounced(): Promise<void> {
  try {
    const local = await getCompareProducts();
    const merged = await syncCompareProductsWithCloud(local);
    const list = merged ?? local;
    if (merged) {
      await saveCompareProductsLocal(merged);
    }
    void hydrateCompareImages(list, async (updated) => {
      await saveCompareProductsLocal(updated);
    }).catch((error) => {
      console.warn('[PriceGuard] compare image hydrate:', error);
    });
  } catch (error) {
    console.warn('[PriceGuard] compare sync:', error);
  }
}

/** Full sync (post-login). */
export async function syncCompareProductsFromCloud(): Promise<boolean> {
  try {
    const local = await getCompareProducts();
    const merged = await syncCompareProductsWithCloud(local);
    const list = merged ?? local;
    if (merged) {
      await saveCompareProductsLocal(merged);
    }
    void hydrateCompareImages(list, async (updated) => {
      await saveCompareProductsLocal(updated);
    }).catch((error) => {
      console.warn('[PriceGuard] compare image hydrate:', error);
    });
    return Boolean(merged);
  } catch (error) {
    console.warn('[PriceGuard] compare sync pull:', error);
    return false;
  }
}

export async function removeCompareProduct(id: string): Promise<void> {
  const products = await getCompareProducts();
  await markCompareDeleted(id);
  await saveCompareProducts(products.filter((p) => p.id !== id));

  const selected = await getSelectedCompareId();
  if (selected === id) {
    await chrome.storage.local.remove(SELECTED_KEY);
  }
}

export async function getSelectedCompareId(): Promise<string | null> {
  const stored = await chrome.storage.local.get(SELECTED_KEY);
  return (stored[SELECTED_KEY] as string | undefined) ?? null;
}

export async function setSelectedCompareId(id: string | null): Promise<void> {
  if (id) {
    await chrome.storage.local.set({ [SELECTED_KEY]: id });
  } else {
    await chrome.storage.local.remove(SELECTED_KEY);
  }
}

export async function updateCompareProduct(product: CompareProduct): Promise<void> {
  const deleted = await getCompareDeletedIds();
  if (deleted.includes(product.id)) return;
  const products = await getCompareProducts();
  if (!products.some((p) => p.id === product.id)) return;
  await saveCompareProducts(products.map((p) => (p.id === product.id ? product : p)));
}
