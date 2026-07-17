import type { CompareProduct } from '@/types/comparison';
import {
  findDuplicateCompareProduct,
  mergeCompareProducts,
} from '@/lib/compare-merge';

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
    await saveCompareProducts(consolidated);
  }

  return consolidated;
}

export async function saveCompareProducts(products: CompareProduct[]): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: products });
}

export async function removeCompareProduct(id: string): Promise<void> {
  const products = await getCompareProducts();
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
  const products = await getCompareProducts();
  await saveCompareProducts(products.map((p) => (p.id === product.id ? product : p)));
}
