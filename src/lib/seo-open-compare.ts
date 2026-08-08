/**
 * Handle SEO site → extension compare open (externally_connectable).
 * Minimal bridge: prefer first offer URL → ENSURE_COMPARE path; else stash query for popup.
 */

import { resolveAndAddCompareProduct } from '@/lib/compare-resolve';
import { researchClearAutoOnly } from '@/lib/candidate-pool';
import { runCompareJob, clearCompareRunning } from '@/lib/compare-jobs';
import { shouldRunCompare } from '@/lib/compare-cache';
import { setSelectedCompareId, updateCompareProduct } from '@/lib/comparison-storage';

export const SEO_PENDING_COMPARE_KEY = 'priceguard_seo_pending_compare';

export type SeoOpenComparePayload = {
  title: string;
  brand: string | null;
  slug: string;
  productKey: string | null;
  query: string;
  offerHints: Array<{ marketplace: string; productId: string; url: string }>;
};

export type SeoOpenCompareResult =
  | { ok: true; productId?: string; started?: boolean; via: 'offer_url' | 'pending_query' }
  | { ok: false; error: string };

export async function handleSeoOpenCompare(
  payload: SeoOpenComparePayload,
): Promise<SeoOpenCompareResult> {
  const query = (payload.query || payload.title || '').trim().slice(0, 120);
  const firstUrl = payload.offerHints?.find((h) => h.url?.trim())?.url?.trim();

  await chrome.storage.local.set({
    [SEO_PENDING_COMPARE_KEY]: {
      query,
      title: payload.title,
      brand: payload.brand,
      slug: payload.slug,
      productKey: payload.productKey,
      offerHints: payload.offerHints ?? [],
      at: Date.now(),
    },
  });

  try {
    if (typeof chrome.action?.openPopup === 'function') {
      void chrome.action.openPopup().catch(() => undefined);
    }
  } catch {
    // popup may fail if no user gesture — storage still set
  }

  if (firstUrl) {
    try {
      const product = await resolveAndAddCompareProduct(firstUrl, undefined, {
        title: payload.title || query,
      });
      await setSelectedCompareId(product.id);
      const willCompare = shouldRunCompare(product, true);
      if (willCompare) {
        await clearCompareRunning();
        const cleared = researchClearAutoOnly(product, { preservePendingChoice: true });
        await updateCompareProduct(cleared);
        void runCompareJob(cleared, true, 'research');
      }
      return { ok: true, productId: product.id, started: willCompare, via: 'offer_url' };
    } catch (e) {
      console.warn('[PriceGuard] SEO_OPEN_COMPARE offer url failed', e);
      // fall through — pending query still stored
    }
  }

  return { ok: true, via: 'pending_query' };
}
