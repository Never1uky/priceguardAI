/** Сообщения и хелперы для недоступных / распроданных карточек */

export const OUT_OF_STOCK_ERROR = 'Нет в наличии';

export function isOutOfStockError(error?: string | null): boolean {
  if (!error) return false;
  return (
    error === OUT_OF_STOCK_ERROR ||
    /нет в наличии|распродан|недоступен|out of stock|sold out/i.test(error)
  );
}

export function outOfStockOffer(
  marketplace: import('@/types/comparison').ComparisonMarketplace,
  title: string,
  url: string,
  partial?: Partial<import('@/types/comparison').MarketplaceOffer>,
): import('@/types/comparison').MarketplaceOffer {
  return {
    marketplace,
    title: title || 'Товар',
    price: null,
    delivery: null,
    rating: null,
    url,
    found: false,
    error: OUT_OF_STOCK_ERROR,
    ...partial,
  };
}
