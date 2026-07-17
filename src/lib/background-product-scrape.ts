import { sendScrapeProductMessage } from '@/lib/active-product-tab';
import { agentLog } from '@/lib/debug-log';
import { saveLastScrapedProduct } from '@/lib/storage';
import type { Product } from '@/types/product';
import { detectMarketplace, extractArticle, isProductPage } from '@/utils/marketplace';
import { fetchWildberriesProduct } from '@/utils/parsers/wb-api';
import { toCanonicalProductUrl } from '@/utils/product-url';
import { buildWbImageUrlAlternatives } from '@/utils/wb-image';

/** Загрузка товара из background без content script (fallback для WB API). */
export async function fetchProductFromTabUrl(url: string): Promise<Product | null> {
  if (!isProductPage(url)) return null;

  const marketplace = detectMarketplace(url);
  if (marketplace !== 'wildberries') return null;

  const article = extractArticle(url, 'wildberries');
  if (!article) return null;

  const api = await fetchWildberriesProduct(article);
  if (!api?.price || !api.title) return null;

  const normalizedUrl = toCanonicalProductUrl(url, 'wildberries');

  return {
    id: `wb-${article}`,
    marketplace: 'wildberries',
    title: api.title,
    price: api.price,
    oldPrice: api.oldPrice,
    currency: '₽',
    article,
    url: normalizedUrl,
    imageUrl: api.imageUrl,
    imageUrlAlternatives: api.imageUrlAlternatives ?? buildWbImageUrlAlternatives(article),
    scrapedAt: Date.now(),
  };
}

export async function resolveProductForTab(tab: chrome.tabs.Tab): Promise<{
  ok: boolean;
  product?: Product;
  isProductPage?: boolean;
  error?: string;
  needsRefresh?: boolean;
  source?: 'content' | 'api';
}> {
  if (!tab.id || !tab.url) {
    return { ok: false, error: 'Активная вкладка не найдена' };
  }

  if (!isProductPage(tab.url)) {
    return {
      ok: false,
      error: 'Откройте страницу товара на Wildberries, Ozon или Яндекс.Маркет',
    };
  }

  try {
    const response = (await sendScrapeProductMessage(tab.id)) as {
      ok?: boolean;
      product?: Product;
      isProductPage?: boolean;
      error?: string;
    };

    if (response?.ok && response.product) {
      agentLog(
        'background-product-scrape.ts:resolveProductForTab',
        'content script product',
        { source: 'content', title: response.product.title?.slice(0, 40) },
        'B',
      );
      return { ok: true, product: response.product, source: 'content' };
    }
  } catch (error) {
    agentLog(
      'background-product-scrape.ts:resolveProductForTab',
      'content script failed',
      { error: error instanceof Error ? error.message : String(error) },
      'I',
    );
  }

  const apiProduct = await fetchProductFromTabUrl(tab.url);
  if (apiProduct) {
    await saveLastScrapedProduct(apiProduct);
    agentLog(
      'background-product-scrape.ts:resolveProductForTab',
      'API fallback product',
      { source: 'api', title: apiProduct.title.slice(0, 40), price: apiProduct.price },
      'K',
    );
    return { ok: true, product: apiProduct, isProductPage: true, source: 'api' };
  }

  return {
    ok: false,
    isProductPage: true,
    error: 'Данные товара ещё загружаются — нажмите «Обновить»',
    needsRefresh: true,
  };
}
