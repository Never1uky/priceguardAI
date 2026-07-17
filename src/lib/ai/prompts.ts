import {
  FULL_ANALYSIS_JSON_SCHEMA,
  REVIEW_ANALYSIS_JSON_SCHEMA,
  schemaToPromptBlock,
} from '@/lib/ai/schemas';

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

Верни ТОЛЬКО валидный JSON (schema v2). Без markdown, SEO-текста, описаний фото.

Задача:
1. Отзывы → qualityScore, pros/cons, fakeRisk, hiddenProblems.
2. Блок «Данные из интернета» (если есть) → webOverview + alternatives; иначе не выдумывай обзоры.
3. Короткая рекомендация (verdict + explanation).
4. priceInsight — одна фраза; детали цены UI пересчитает сам.

Схема:
${schemaToPromptBlock(FULL_ANALYSIS_JSON_SCHEMA)}

Правила: alternatives 0–3 реальных моделей; конкретика из отзывов/веба; русский; короткие поля.`;

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
}): string {
  const lines = [
    `Товар: ${input.productTitle}`,
    `Артикул: ${input.article}`,
    `Маркетплейс: ${input.marketplace}`,
    `Цена: ${input.productPrice} ₽`,
    input.oldPrice ? `Старая цена: ${input.oldPrice} ₽` : null,
    `Отзывов для анализа: ${input.reviews.length} (всего на странице: ${input.totalReviewsFound ?? input.reviews.length})`,
  ].filter(Boolean);

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

  const reviewsBlock = input.reviews
    .slice(0, 16)
    .map((r, i) => `--- Отзыв ${i + 1} ---\n${r.slice(0, 420)}`)
    .join('\n\n');

  return `${lines.join('\n')}\n\nОтзывы покупателей:\n\n${reviewsBlock}`;
}
