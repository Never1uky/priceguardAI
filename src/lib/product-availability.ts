import type { Marketplace } from '@/types/product';
import type { Product } from '@/types/product';
import { toCanonicalProductUrl } from '@/utils/product-url';

export type ProductAvailability = 'in_stock' | 'out_of_stock';

export function isProductOutOfStock(
  product: Pick<Product, 'price' | 'availability'>,
): boolean {
  return product.availability === 'out_of_stock' || !(product.price > 0);
}

export function buildOutOfStockProduct(params: {
  marketplace: Marketplace;
  title: string;
  article: string;
  url: string;
  imageUrl?: string;
  imageUrlAlternatives?: string[];
  oldPrice?: number;
  authenticity?: Product['authenticity'];
}): Product {
  const { marketplace, article } = params;
  return {
    id: `${marketplace === 'wildberries' ? 'wb' : marketplace === 'ozon' ? 'ozon' : 'ym'}-${article}`,
    marketplace,
    title: params.title,
    price: 0,
    oldPrice: params.oldPrice,
    currency: '₽',
    article,
    url: toCanonicalProductUrl(params.url, marketplace),
    imageUrl: params.imageUrl,
    imageUrlAlternatives: params.imageUrlAlternatives,
    scrapedAt: Date.now(),
    authenticity: params.authenticity,
    availability: 'out_of_stock',
  };
}
