import type { Marketplace } from '@/types/product';
import type { ProductAuthenticity } from '@/types/authenticity';
import { evaluateAuthenticity, ORIGINAL_LABEL_RE } from '@/lib/authenticity/detect-core';

const HEADER_SELECTORS = [
  'h1',
  '[class*="productTitle"]',
  '[class*="product-page__header"]',
  '[class*="product-page__brand"]',
  '[data-widget="webProductHeading"]',
  '[data-widget="webBrand"]',
  '[class*="product-card__top"]',
  '[class*="product-card__header"]',
  '[data-auto="productCardTitle"]',
  '[data-zone-name="productTitle"]',
  '[data-baobab-name="title"]',
];

/** Узкие селекторы самой метки «Оригинал» на WB / Ozon / YM */
const BADGE_SELECTORS = [
  '[class*="original" i]',
  '[class*="Original"]',
  '[class*="authenticit" i]',
  '[class*="verified" i]',
  '[data-link*="original" i]',
  '[data-name*="original" i]',
  '[data-auto*="original" i]',
  '[aria-label*="оригинал" i]',
  '[title*="оригинал" i]',
  '[data-widget="webBrand"]',
];

function classMatchesOriginal(className: string): boolean {
  return /original|verified|authenticit|check/i.test(className);
}

function findHeaderRoot(doc: Document): Element | null {
  for (const selector of HEADER_SELECTORS) {
    const el = doc.querySelector(selector);
    if (!el) continue;
    // Не берём весь <main> — иначе ловим «оригинал» из отзывов
    const brandWrap = el.closest(
      '[class*="brand" i], [class*="header" i], [class*="title" i], [data-widget="webProductHeading"], [data-widget="webBrand"], [class*="product-card__top"]',
    );
    if (brandWrap) return brandWrap;
    return el.parentElement ?? el;
  }
  return null;
}

function hasCheckIcon(container: Element): boolean {
  if (
    container.querySelector(
      'svg, img[alt*="галоч" i], img[alt*="check" i], img[alt*="оригинал" i], [class*="check" i]',
    )
  ) {
    return true;
  }
  for (const el of container.querySelectorAll('[class], svg, img')) {
    const cls = el.getAttribute('class') ?? '';
    if (classMatchesOriginal(cls) && (el.tagName === 'SVG' || el.querySelector('svg') || el.tagName === 'IMG')) {
      return true;
    }
  }
  return false;
}

function normalizeBadgeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Короткий текст узла похож на бейдж «Оригинал» / «Оригинальный товар» */
function isOriginalBadgeText(text: string): boolean {
  const t = normalizeBadgeText(text);
  if (!t || t.length > 48) return false;
  return ORIGINAL_LABEL_RE.test(t);
}

function findOriginalBadgeInTree(root: ParentNode): {
  hasLabel: boolean;
  hasBadge: boolean;
  hasIcon: boolean;
} {
  let hasLabel = false;
  let hasBadge = false;
  let hasIcon = false;

  for (const selector of BADGE_SELECTORS) {
    try {
      for (const el of root.querySelectorAll(selector)) {
        const text = normalizeBadgeText(el.textContent ?? '');
        const aria = el.getAttribute('aria-label') ?? el.getAttribute('title') ?? '';
        if (isOriginalBadgeText(text) || isOriginalBadgeText(aria)) {
          hasLabel = true;
          hasBadge = true;
          if (hasCheckIcon(el) || hasCheckIcon(el.parentElement ?? el)) hasIcon = true;
        }
        if (classMatchesOriginal(el.getAttribute('class') ?? '') && hasCheckIcon(el)) {
          hasIcon = true;
        }
      }
    } catch {
      // invalid selector in older engines — skip
    }
  }

  // Обход коротких текстовых узлов рядом с заголовком
  const walkerTargets = root.querySelectorAll('span, div, p, a, button, li, label');
  for (const el of walkerTargets) {
    const text = normalizeBadgeText(el.textContent ?? '');
    if (!isOriginalBadgeText(text)) continue;
    // Игнорируем длинные блоки (описание / отзывы)
    if ((el.textContent?.length ?? 0) > 80) continue;
    hasLabel = true;
    if (hasCheckIcon(el) || hasCheckIcon(el.parentElement ?? el) || classMatchesOriginal(el.getAttribute('class') ?? '')) {
      hasBadge = true;
      hasIcon = true;
    } else {
      // Текст «Оригинал» в зоне бренда без SVG тоже считаем меткой (галочка часто в CSS)
      hasBadge = true;
    }
  }

  return { hasLabel, hasBadge, hasIcon };
}

/** Проверка метки «Оригинал» на открытой странице (content script). */
export function detectAuthenticityFromDom(
  marketplace: Marketplace,
  doc: Document = document,
): ProductAuthenticity {
  const titleEl = doc.querySelector(
    'h1, [class*="productTitle"], [data-widget="webProductHeading"] h1, [data-auto="productCardTitle"]',
  );
  const title = titleEl?.textContent?.trim();

  const headerRoot = findHeaderRoot(doc);
  const searchRoots: ParentNode[] = [];
  if (headerRoot) searchRoots.push(headerRoot);
  // Расширяем зону поиска: бренд + верх карточки, без всего body
  const extra = doc.querySelector(
    '[class*="product-page__brand"], [class*="product-page__header"], [data-widget="webProductHeading"], [data-widget="webBrand"], [class*="product-card__top"], [class*="productSummary"]',
  );
  if (extra && extra !== headerRoot) searchRoots.push(extra);

  if (!searchRoots.length) {
    return evaluateAuthenticity({
      marketplace,
      title,
      isProductPage: Boolean(title),
    });
  }

  let hasOriginalLabel = false;
  let hasOriginalBadge = false;
  let hasVerifiedIcon = false;
  const headerChunks: string[] = [];

  for (const root of searchRoots) {
    const found = findOriginalBadgeInTree(root);
    hasOriginalLabel = hasOriginalLabel || found.hasLabel;
    hasOriginalBadge = hasOriginalBadge || found.hasBadge;
    hasVerifiedIcon = hasVerifiedIcon || found.hasIcon;
    if (root instanceof Element) {
      headerChunks.push((root.textContent ?? '').slice(0, 500));
    }
  }

  return evaluateAuthenticity({
    marketplace,
    title,
    headerText: headerChunks.join('\n'),
    hasOriginalBadge,
    hasOriginalLabel,
    hasVerifiedIcon,
    isProductPage: true,
  });
}
