import {
  FULL_ANALYSIS_JSON_SCHEMA,
  REVIEW_ANALYSIS_JSON_SCHEMA,
  schemaToPromptBlock,
} from '@/lib/ai/schemas';
import { inferProductCategory } from '@/lib/match-category';
import { formatFocusAxesPromptBlock } from '@/lib/seo/category-focus';

export const REVIEW_ANALYSIS_SYSTEM_PROMPT = `Ты — эксперт по анализу отзывов на маркетплейсах Wildberries, Ozon и Яндекс.Маркет.

Проанализируй отзывы покупателей и верни ТОЛЬКО валидный JSON без markdown и комментариев.
Строго следуй схеме — все поля обязательны.

Схема ответа:
${schemaToPromptBlock(REVIEW_ANALYSIS_JSON_SCHEMA)}

Критерии fakeRisk:
- low: разнообразные детальные отзывы, есть конкретика, критика и похвала
- medium: много шаблонных фраз, мало деталей, подозрительная однотипность
- high: явная накрутка, копипаста, нереалистичный восторг без деталей

Критерии verdict:
- buy_now: рейтинг ≥4, минусы некритичны, низкий fakeRisk
- wait_discount: товар неплохой, но есть существенные минусы или лучше дождаться скидки
- not_recommended: много негатива, брак, обман, высокий fakeRisk`;

export function buildReviewAnalysisUserPrompt(input: {
  productTitle: string;
  productPrice?: number;
  marketplace?: string;
  reviews: string[];
}): string {
  const header = [
    `Товар: ${input.productTitle}`,
    input.marketplace ? `Маркетплейс: ${input.marketplace}` : null,
    input.productPrice ? `Текущая цена: ${input.productPrice} ₽` : null,
    `Количество отзывов: ${input.reviews.length}`,
  ]
    .filter(Boolean)
    .join('\n');

  const body = input.reviews
    .slice(0, 25)
    .map((review, index) => `--- Отзыв ${index + 1} ---\n${review.slice(0, 600)}`)
    .join('\n\n');

  return `${header}\n\nОтзывы:\n\n${body}`;
}

/** Шаг 1 Premium: Perplexity Sonar — обзор из сети (без JSON) */
export const WEB_RESEARCH_SYSTEM_PROMPT = `Ты — исследователь товаров для российских покупателей.
Найди в интернете обзоры, сравнения и типичные мнения о товаре.
Пиши кратко на русском (до 450 слов). Не выдумывай факты без источников.
Структура ответа:
1) Репутация модели
2) Плюсы из обзоров
3) Минусы / известные проблемы
4) С чем сравнивают / альтернативы
5) Краткий вывод`;

export function buildWebResearchUserPrompt(input: {
  productTitle: string;
  article?: string;
  marketplace?: string;
  productPrice?: number;
}): string {
  return [
    `Товар: ${input.productTitle}`,
    input.article ? `Артикул: ${input.article}` : null,
    input.marketplace ? `Маркетплейс карточки: ${input.marketplace}` : null,
    input.productPrice ? `Цена на карточке: ${input.productPrice} ₽` : null,
    '',
    'Найди актуальные обзоры и мнения в сети (не только отзывы маркетплейса).',
  ]
    .filter((line) => line !== null)
    .join('\n');
}

export const FULL_ANALYSIS_SYSTEM_PROMPT = `Ты — эксперт по покупкам на WB / Ozon / Яндекс.Маркет.

Верни ТОЛЬКО валидный JSON (schema v3). Без markdown, SEO-статьи, описаний фото.

Тон: как человек, который быстро прочитал отзывы и характеристики. Без рекламы и клише («идеальный выбор», «must have»).
Не повторяй название товара в каждом поле. Не выдумывай характеристики (ANC, материалы и т.п.) — только из отзывов, title или блока «Данные из интернета».
Если данных мало — укажи в dataGaps или опусти поле; не выдавай предположение за факт.
pros/cons — конкретика («микрофон в ветре»), не «хорошее качество».
alternatives — только реальные модели; 0 лучше, чем выдумка.
Не пиши длинный SEO-текст и не генерируй FAQ HTML.

Задача:
1. Отзывы → qualityScore, pros/cons, fakeRisk, hiddenProblems, reviewThemes.
2. Блок «Данные из интернета» (если есть) → webOverview + alternatives.
3. Если веб-блока нет: всё равно заполни webOverview 2–4 предложениями (≥80 символов) как синтез из отзывов, названия и осей категории — без выдуманных «обзоров из сети» и без фейковых цитат.
4. Короткая рекомендация (verdict + explanation) — вывод отдельно от фактов отзывов.
5. audienceFit / audienceAvoid — только если обосновано данными.
6. priceInsight — одна фраза без прогноза будущей цены.

Схема:
${schemaToPromptBlock(FULL_ANALYSIS_JSON_SCHEMA)}

Правила: русский; короткие поля; опирайся на оси категории из user prompt, если переданы.`;

export function buildFullAnalysisUserPrompt(input: {
  productTitle: string;
  productPrice: number;
  oldPrice?: number;
  marketplace: string;
  article: string;
  reviews: string[];
  totalReviewsFound?: number;
  priceHistory?: Array<{ price: number; date: string }>;
  compareOffers?: Array<{
    marketplace: string;
    price: number | null;
    rating: number | null;
    title: string;
  }>;
  /** Результат Perplexity Sonar (Premium) */
  webResearch?: string;
  /** ProductCategory id / SEO category_slug for focus axes */
  categorySlug?: string | null;
}): string {
  const lines = [
    `Товар: ${input.productTitle}`,
    `Артикул: ${input.article}`,
    `Маркетплейс: ${input.marketplace}`,
    `Цена: ${input.productPrice} ₽`,
    input.oldPrice ? `Старая цена: ${input.oldPrice} ₽` : null,
    `Отзывов для анализа: ${input.reviews.length} (всего на странице: ${input.totalReviewsFound ?? input.reviews.length})`,
  ].filter(Boolean);

  lines.push(
    '',
    formatFocusAxesPromptBlock(
      input.categorySlug && input.categorySlug !== 'generic'
        ? input.categorySlug
        : (() => {
            const inferred = inferProductCategory(input.productTitle);
            return inferred === 'generic' ? null : inferred;
          })(),
    ),
  );

  if (input.priceHistory?.length) {
    lines.push(
      'История цен:',
      ...input.priceHistory.slice(-10).map((p) => `  ${p.date}: ${p.price} ₽`),
    );
  }

  if (input.compareOffers?.length) {
    lines.push('Цены на других площадках (для сравнения и альтернатив):');
    for (const o of input.compareOffers) {
      lines.push(
        `  ${o.marketplace}: ${o.price ?? '—'} ₽, рейтинг ${o.rating ?? '—'}, ${o.title.slice(0, 60)}`,
      );
    }
  }

  if (input.webResearch?.trim()) {
    lines.push(
      '',
      'Данные из интернета (Perplexity Sonar):',
      input.webResearch.trim().slice(0, 3_500),
    );
  }

  if (input.reviews.length === 0) {
    if (input.webResearch?.trim()) {
      lines.push(
        '',
        'На маркетплейсе нет отзывов для анализа. Опирайся на данные Sonar.',
        'fakeRisk: medium (если данных мало — укажи в fakeRiskExplanation); qualityScore — из обзоров в сети.',
      );
    }
    return lines.join('\n');
  }

  const reviewsBlock = input.reviews
    .slice(0, 16)
    .map((r, i) => `--- Отзыв ${i + 1} ---\n${r.slice(0, 420)}`)
    .join('\n\n');

  return `${lines.join('\n')}\n\nОтзывы покупателей:\n\n${reviewsBlock}`;
}
