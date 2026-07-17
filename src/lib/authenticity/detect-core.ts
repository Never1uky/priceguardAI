import type { Marketplace } from '@/types/product';
import type { AuthenticityStatus, ProductAuthenticity } from '@/types/authenticity';

/**
 * Бренды/категории, где маркетплейсы обычно показывают метку «Оригинал».
 * Используется только как контекст — отсутствие метки само по себе НЕ = подделка.
 */
export const AUTHENTICITY_RELEVANT_BRAND_RE =
  /\b(apple|airpods|iphone|ipad|macbook|samsung|galaxy|sony|playstation|ps5|xbox|nintendo|dyson|bose|jbl|marshall|xiaomi|redmi|poco|huawei|honor|oneplus|realme|lego|nike|adidas|puma|new\s*balance|reebok|gucci|louis\s*vuitton|chanel|dior|prada|hermes|rolex|casio|garmin|canon|nikon|gopro|dyson|braun|philips|oral[\s-]?b|loreal|l'oreal|maybelline|clinique|estee\s*lauder|ysl|versace|calvin\s*klein|tommy\s*hilfiger|levis|zara|h&m)\b/i;

/** Явные признаки неоригинала в названии / описании (без \b — кириллица) */
export const COUNTERFEIT_HINT_RE =
  /подделк|реплик|не\s*оригинал|неоригинал|\bкопия\b|\bкопии\b|\banalog\b|аналог|1\s*:\s*1|airpro|air\s*pro(?!\s*max\b)|pods\s*max\s*gut|compatible\s*with|совместим(?:ый|ая)?\s+с/i;

/** Текст официальной метки маркетплейса */
export const ORIGINAL_LABEL_RE =
  /оригинал(?:ьный(?:\s+товар)?)?|original(?:\s+product)?|проверенн(?:ый|ая)\s+оригинал|официальн(?:ый|ая)\s+(?:магазин|продукц)/i;

export interface AuthenticityScanInput {
  marketplace: Marketplace;
  title?: string;
  /** Текст блока заголовка / бренда (DOM или HTML) */
  headerText?: string;
  /** Есть ли явная метка «Оригинал» с иконкой галочки */
  hasOriginalBadge?: boolean;
  /** Явный текст «Оригинал» рядом с названием */
  hasOriginalLabel?: boolean;
  /** SVG / иконка проверки в зоне бренда */
  hasVerifiedIcon?: boolean;
  isProductPage?: boolean;
}

export function evaluateAuthenticity(input: AuthenticityScanInput): ProductAuthenticity {
  const now = Date.now();
  const title = input.title?.trim() ?? '';
  const header = input.headerText ?? '';
  const blob = `${title}\n${header}`;

  // 1) Явная метка маркетплейса — главный позитивный сигнал
  const markedOriginal =
    Boolean(input.hasOriginalBadge) ||
    Boolean(input.hasOriginalLabel && input.hasVerifiedIcon) ||
    Boolean(input.hasOriginalLabel);

  if (markedOriginal) {
    return { status: 'original', label: 'Оригинал', detectedAt: now };
  }

  // 2) Явные слова про подделку / реплику
  if (COUNTERFEIT_HINT_RE.test(blob)) {
    return {
      status: 'not_original',
      label: 'Признаки неоригинала в названии',
      detectedAt: now,
    };
  }

  if (!input.isProductPage) {
    return { status: 'unknown', detectedAt: now };
  }

  // 3) Бренд без найденной метки — НЕ предупреждаем.
  // Раньше здесь был not_original → ложные «Возможно не оригинал» на PS5/Apple и т.п.,
  // когда бейдж на странице есть, но селектор его не поймал.
  return { status: 'unknown', detectedAt: now };
}

export function scanHtmlForAuthenticity(
  marketplace: Marketplace,
  html: string,
  title?: string,
): ProductAuthenticity {
  const headerSlice = html.slice(0, Math.min(html.length, 40_000));
  const textSlice = headerSlice.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ');

  const hasOriginalLabel = ORIGINAL_LABEL_RE.test(textSlice) || ORIGINAL_LABEL_RE.test(headerSlice);
  const hasVerifiedIcon =
    /<svg[\s\S]{0,800}?(?:check|verified|галоч)/i.test(headerSlice) ||
    /class="[^"]*(?:original|verified|authenticit|check)[^"]*"/i.test(headerSlice) ||
    /data-widget="webBrand"[\s\S]{0,1200}?<svg/i.test(headerSlice) ||
    /aria-label="[^"]*оригинал[^"]*"/i.test(headerSlice);

  const hasOriginalBadge =
    (hasOriginalLabel &&
      (hasVerifiedIcon ||
        /class="[^"]*original[^"]*"/i.test(headerSlice) ||
        /product-page__original/i.test(headerSlice) ||
        /data-(?:link|name|auto)="[^"]*original[^"]*"/i.test(headerSlice))) ||
    /оригинал(?:ьный(?:\s+товар)?)?/i.test(
      headerSlice.match(/<(?:span|div|p|a|button)[^>]{0,200}>([^<]{0,80})/gi)?.join(' ') ?? '',
    );

  const isProductPage =
    /<h1\b/i.test(headerSlice) ||
    /webProductHeading/i.test(headerSlice) ||
    /productTitle/i.test(headerSlice) ||
    /product-page/i.test(headerSlice) ||
    /product-card/i.test(headerSlice);

  const titleFromHtml =
    title ??
    headerSlice.match(/<h1[^>]*>([^<]{4,200})/i)?.[1]?.trim() ??
    headerSlice.match(/class="[^"]*product-card__name[^"]*"[^>]*>([^<]{4,200})/i)?.[1]?.trim();

  return evaluateAuthenticity({
    marketplace,
    title: titleFromHtml,
    headerText: textSlice.slice(0, 3000),
    hasOriginalBadge,
    hasOriginalLabel,
    hasVerifiedIcon,
    isProductPage,
  });
}

export function statusLabel(status: AuthenticityStatus): string {
  switch (status) {
    case 'original':
      return 'Оригинал';
    case 'not_original':
      return 'Возможно не оригинал';
    default:
      return 'Не проверено';
  }
}

/** Нужна ли мягкая подсказка «ищем метку» — сейчас не показываем в UI */
export function isAuthenticityRelevantTitle(title: string): boolean {
  return AUTHENTICITY_RELEVANT_BRAND_RE.test(title);
}
