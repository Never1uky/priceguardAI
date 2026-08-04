/**
 * Premium: цена карточки через Edge Unlocker (Scrappey), когда API + вкладка не дали цену.
 */

import { callEdgeSafe } from '@/lib/supabase/edge';
import { isPremium } from '@/lib/subscription';
import type { ComparisonMarketplace, MarketplaceOffer } from '@/types/comparison';
import { extractComparisonArticle } from '@/utils/comparison-url';

export async function fetchOfferViaPremiumUnlocker(
  url: string,
  marketplace: ComparisonMarketplace,
): Promise<MarketplaceOffer | null> {
  try {
    if (!(await isPremium())) return null;
  } catch {
    return null;
  }

  const productId = extractComparisonArticle(url, marketplace) || undefined;

  const res = await callEdgeSafe<{
    ok?: boolean;
    price?: number;
    title?: string | null;
    url?: string;
    source?: string;
    error?: string;
  }>('fetch-product-price', {
    marketplace,
    url,
    productId,
    skipCache: true,
  });

  if (!res?.ok || !res.price || res.price <= 0) return null;

  return {
    marketplace,
    title: res.title?.trim() || 'Товар',
    price: res.price,
    delivery: null,
    rating: null,
    url: res.url || url,
    found: true,
  };
}
