import { parsePrice } from '@/utils/dom';

/** Маркеры акций / промо-цен (кошелёк, карта, промокод) — не учитываем */
const PROMO_TEXT_KEYWORDS = [
  'кошелёк',
  'кошелек',
  'wb кошел',
  'с wb',
  'ozon карт',
  'озон карт',
  'с картой ozon',
  'по карте',
  'промокод',
  'промо',
  'при оплате',
  'за отзыв',
  'сбер',
  'спасибо',
  'кэшбэк',
  'cashback',
  'рассрочк',
  'выплатим',
  'баллами',
];

const PROMO_CLASS_PATTERNS = [
  'wallet',
  'Wallet',
  'promo',
  'Promo',
  'cashback',
  'bonus',
  'withcard',
  'with-card',
  'cardprice',
  'card-price',
  'installment',
  'marketing',
];

const BASE_PRICE_SELECTORS = [
  '[class*="priceBlockFinalPrice"]',
  '[class*="price-block__final-price"]',
  '.price-block__final-price',
  '[class*="final-price"]:not([class*="wallet"]):not([class*="Wallet"])',
  '[class*="FinalPrice"]:not([class*="wallet"])',
  '[data-widget="webPrice"] > div > span:first-of-type',
  '[data-widget="webPrice"] span[class*="tsHeadline"]:not([class*="card"])',
];

const OLD_PRICE_SELECTORS = [
  '[class*="priceBlockOldPrice"]',
  '[class*="price-block__old-price"]',
  '[class*="Price_old"]',
  '[class*="old-price"]',
  '[class*="OldPrice"]',
  'del',
  's',
];

function getContextText(element: Element, depth = 4): string {
  let node: Element | null = element;
  let text = '';
  let level = 0;

  while (node && level < depth) {
    text += ` ${node.textContent ?? ''} ${node.className?.toString() ?? ''}`;
    node = node.parentElement;
    level += 1;
  }

  return text.toLowerCase();
}

export function isPromotionalPriceContext(element: Element): boolean {
  const context = getContextText(element);

  if (PROMO_TEXT_KEYWORDS.some((keyword) => context.includes(keyword))) {
    return true;
  }

  return PROMO_CLASS_PATTERNS.some((pattern) => context.includes(pattern.toLowerCase()));
}

function queryBasePriceElements(root: ParentNode): Element[] {
  const found: Element[] = [];

  for (const selector of BASE_PRICE_SELECTORS) {
    try {
      root.querySelectorAll(selector).forEach((element) => {
        if (!isPromotionalPriceContext(element)) {
          found.push(element);
        }
      });
    } catch {
      // skip invalid selector
    }
  }

  return found;
}

function getOldPriceFromBlock(root: ParentNode): number | undefined {
  for (const selector of OLD_PRICE_SELECTORS) {
    try {
      const elements = root.querySelectorAll(selector);
      for (const element of elements) {
        if (isPromotionalPriceContext(element)) continue;
        const value = parsePrice(element.textContent);
        if (value > 0) return value;
      }
    } catch {
      // skip
    }
  }
  return undefined;
}

/**
 * Базовая цена без WB Кошелька / Ozon Card.
 * Для WB: ищем блок «без WB Кошелька» или берём наибольшую непромо-цену.
 */
export function extractWbPriceWithoutWallet(priceBlock: ParentNode): {
  price?: number;
  oldPrice?: number;
} {
  const blocks = priceBlock.querySelectorAll('*');

  for (const element of blocks) {
    const text = (element.textContent ?? '').toLowerCase();
    if (!text.includes('без') || !text.includes('кошел')) continue;
    if (text.length > 200) continue;

    const prices = [...text.matchAll(/(\d[\d\s]*)/g)]
      .map((m) => parsePrice(m[1]))
      .filter((p) => p >= 50);

    if (prices.length) {
      const price = Math.max(...prices);
      const oldPrice = getOldPriceFromBlock(priceBlock);
      return {
        price,
        oldPrice: oldPrice && oldPrice > price ? oldPrice : undefined,
      };
    }
  }

  return extractBaseDiscountPrice(priceBlock);
}

/**
 * Базовая цена со скидкой маркетплейса, без акций (кошелёк WB, Ozon Card и т.п.).
 * Если есть несколько кандидатов — берём наибольшую непромо цену (кошелёк/карта обычно ниже).
 */
export function extractBaseDiscountPrice(priceBlock: ParentNode): {
  price?: number;
  oldPrice?: number;
} {
  const baseElements = queryBasePriceElements(priceBlock);
  const candidates: number[] = [];

  baseElements.forEach((element) => {
    const value = parsePrice(element.textContent);
    if (value > 0) candidates.push(value);
  });

  if (candidates.length === 0) {
    const walker = document.createTreeWalker(priceBlock, NodeFilter.SHOW_ELEMENT);
    let node = walker.nextNode();

    while (node) {
      if (node instanceof Element && !isPromotionalPriceContext(node)) {
        const text = node.textContent ?? '';
        if (/₽|руб/i.test(text) && text.length < 80) {
          const value = parsePrice(text);
          if (value >= 50) candidates.push(value);
        }
      }
      node = walker.nextNode();
    }
  }

  const unique = [...new Set(candidates)].sort((a, b) => a - b);
  if (unique.length === 0) return {};

  const oldPrice = getOldPriceFromBlock(priceBlock);
  const nonOldCandidates = oldPrice
    ? unique.filter((price) => price < oldPrice * 0.98)
    : unique;

  const pool = nonOldCandidates.length > 0 ? nonOldCandidates : unique;
  const price = pool[pool.length - 1];

  return {
    price,
    oldPrice: oldPrice && oldPrice > price ? oldPrice : undefined,
  };
}
