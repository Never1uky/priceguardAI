import type { ProductAuthenticity } from '@/types/authenticity';

export type Marketplace = 'wildberries' | 'ozon' | 'yandex_market';

export interface Product {
  id: string;
  marketplace: Marketplace;
  title: string;
  price: number;
  /** Зачёркнутая / старая цена до скидки */
  oldPrice?: number;
  /**
   * Базовая цена «по карте» / без спец. способа оплаты (Я.Маркет).
   * Если задана — `price` может быть ценой с Пэй.
   */
  basePrice?: number;
  /** Цена при оплате Яндекс Пэй (если отличается от базовой) */
  payPrice?: number;
  currency: string;
  article: string;
  url: string;
  imageUrl?: string;
  /** Запасные URL картинки (WB CDN) */
  imageUrlAlternatives?: string[];
  scrapedAt: number;
  /** Метка «Оригинал» на WB / Ozon */
  authenticity?: ProductAuthenticity;
}

export interface TrackedProduct extends Product {
  trackedAt: number;
  initialPrice: number;
  lowestPrice: number;
  /** Целевая цена — уведомление при достижении */
  targetPrice?: number;
  /** Заметки пользователя (синхронизируются через Supabase) */
  notes?: string;
  /** Уведомления о падении цены для этого товара (по умолчанию включены) */
  notificationsEnabled?: boolean;
}

export interface PricePoint {
  price: number;
  timestamp: number;
}

export interface PriceChange {
  productId: string;
  previousPrice: number;
  newPrice: number;
  dropped: boolean;
}

export interface StorageSchema {
  trackedProducts: TrackedProduct[];
  lastScrapedProduct: Product | null;
  priceHistory: Record<string, PricePoint[]>;
}

/** Сообщения между content script, background и popup */
export type ContentMessage =
  | { type: 'SCRAPE_PRODUCT' }
  | { type: 'GET_CURRENT_PRODUCT' }
  | { type: 'PRODUCT_SCRAPED'; payload: Product }
  | { type: 'PRICE_DROP'; payload: { product: Product; previousPrice: number } }
  | {
      type: 'PRODUCT_PAGE_CHANGED';
      payload: { url: string; tabId?: number; isProductPage?: boolean };
    };

export type ContentResponse =
  | { ok: true; product: Product }
  | { ok: false; error: string; isProductPage?: boolean };
