import type { ProductAuthenticity } from '@/types/authenticity';

export type ComparisonMarketplace = 'wildberries' | 'ozon' | 'yandex_market';

export const COMPARISON_MARKETPLACE_LABELS: Record<ComparisonMarketplace, string> = {
  wildberries: 'Wildberries',
  ozon: 'Ozon',
  yandex_market: 'Яндекс.Маркет',
};

/** Товар, добавленный по ссылке для сравнения цен */
export interface CompareProduct {
  id: string;
  title: string;
  article?: string;
  sourceUrl: string;
  sourceMarketplace: ComparisonMarketplace;
  /** Прямые ссылки на тот же товар на других площадках */
  marketplaceUrls: Partial<Record<ComparisonMarketplace, string>>;
  /** Данные с исходной площадки при добавлении со страницы */
  sourceOffer?: MarketplaceOffer;
  /** Кэш предложений по каждой площадке (при ручном добавлении ссылок) */
  marketplaceOffers?: Partial<Record<ComparisonMarketplace, MarketplaceOffer>>;
  articlesByMarketplace?: Partial<Record<ComparisonMarketplace, string>>;
  addedAt: number;
  /** Площадки, где ссылка задана вручную — автопоиск не перезаписывает */
  manualMarketplaces?: Partial<Record<ComparisonMarketplace, boolean>>;
  /** Когда последний раз выполнялось сравнение цен */
  comparedAt?: number;
  /** Извлечённая модель для точного поиска (AirPods Max, iPhone 13…) */
  productModel?: string;
  /** Отклонённые URL автопоиска («Это не тот товар») */
  rejectedOfferUrls?: Partial<Record<ComparisonMarketplace, string[]>>;
  /** Локальный Top-N пул кандидатов по площадке (Variant B) */
  candidatePoolByMarketplace?: Partial<Record<ComparisonMarketplace, SearchCandidateOffer[]>>;
  /** Когда пул был заполнен (TTL) */
  poolFetchedAt?: Partial<Record<ComparisonMarketplace, number>>;
  /** Номер варианта поискового запроса после отклонений */
  searchVariantByMarketplace?: Partial<Record<ComparisonMarketplace, number>>;
  authenticity?: ProductAuthenticity;
}

export interface MarketplaceOffer {
  marketplace: ComparisonMarketplace;
  title: string;
  /** Основная цена для сравнения (предпочтительно базовая / по карте) */
  price: number | null;
  oldPrice?: number;
  /** Базовая цена без Яндекс Пэй (Я.Маркет) */
  basePrice?: number;
  /** Цена с Яндекс Пэй, если ниже базовой */
  payPrice?: number;
  delivery: string | null;
  rating: number | null;
  reviewCount?: number;
  url: string;
  imageUrl?: string;
  /** Fallback CDN URLs (WB basket hosts) if primary imageUrl 404s */
  imageUrlAlternatives?: string[];
  /** Краткие характеристики с карточки товара */
  specs?: string;
  found: boolean;
  error?: string;
  /** Сходство заголовка с эталоном, 0–100 % — только для алгоритма, не показывать в UI */
  matchConfidence?: number;
  /** Статус уверенности для UI (без процентов) */
  matchStatus?:
    | 'verified'
    | 'probable'
    | 'needs_choice'
    | 'not_found'
    | 'loading_card'
    | 'serp_only'
    | 'oos'
    | 'blocked'
    | 'unverified_manual';
  /** Топ кандидатов из выдачи — пул для выбора / альтернатив */
  searchCandidates?: SearchCandidateOffer[];
  /** Требуется ручной выбор из searchCandidates */
  needsManualPick?: boolean;
}

/** Краткий оффер-кандидат из SERP для UI выбора */
export interface SearchCandidateOffer {
  title: string;
  url: string;
  price: number | null;
  /** Внутренний match score 0–100 — не показывать в UI */
  matchConfidence: number;
  /** Внутренний priority для ранжирования пула */
  priority?: number;
  imageUrl?: string;
  imageUrlAlternatives?: string[];
  rating?: number | null;
}

export interface CompareProductHint {
  title?: string;
  price?: number;
  oldPrice?: number;
  authenticity?: ProductAuthenticity;
}

export interface ComparisonResult {
  product: CompareProduct;
  offers: MarketplaceOffer[];
  comparedAt: number;
}
