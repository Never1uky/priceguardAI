import type { PricePoint } from '@/types/product';

export type PriceInsightKind =
  | 'great_deal'
  | 'good_price'
  | 'average'
  | 'high_price'
  | 'fake_discount'
  | 'unconfirmed_strikethrough';

export interface PriceInsight {
  kind: PriceInsightKind;
  label: string;
  detail: string;
  minPrice: number | null;
  maxPrice: number | null;
  avgPrice: number | null;
}

/** Минимум точек истории для «жёсткого» вердикта о фейковой скидке */
export const FAKE_DISCOUNT_MIN_HISTORY = 5;

/** Допуск: зачёркнутая «встречалась» в истории, если |hist − old| / old ≤ 2% */
export const STRIKE_HISTORY_TOLERANCE = 0.02;

const INSIGHT_LABELS: Record<PriceInsightKind, string> = {
  great_deal: 'Отличная цена',
  good_price: 'Хорошая цена',
  average: 'Средняя цена',
  high_price: 'Цена выше обычной',
  fake_discount: 'Возможна фейковая скидка',
  unconfirmed_strikethrough: 'Скидка не подтверждена историей',
};

/** Была ли зачёркнутая цена (±2%) хотя бы раз в истории наблюдений */
export function strikethroughSeenInHistory(
  history: PricePoint[],
  oldPrice: number,
  tolerance = STRIKE_HISTORY_TOLERANCE,
): boolean {
  if (!oldPrice || oldPrice <= 0 || history.length === 0) return false;
  return history.some((p) => Math.abs(p.price - oldPrice) / oldPrice <= tolerance);
}

export function analyzePriceHistory(
  history: PricePoint[],
  currentPrice: number,
  oldPrice?: number,
): PriceInsight {
  const prices = history.map((p) => p.price);
  const minPrice = prices.length ? Math.min(...prices) : null;
  const maxPrice = prices.length ? Math.max(...prices) : null;
  const avgPrice = prices.length
    ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length)
    : null;

  const hasStrike =
    Boolean(oldPrice && oldPrice > currentPrice && oldPrice > 0) && Boolean(oldPrice);
  const strike = hasStrike ? oldPrice! : undefined;
  const strikeSeen = strike ? strikethroughSeenInHistory(history, strike) : true;

  // Короткая история + цена «до скидки» не встречалась → мягкое предупреждение (не «фейк»)
  if (strike && !strikeSeen && history.length < FAKE_DISCOUNT_MIN_HISTORY) {
    return {
      kind: 'unconfirmed_strikethrough',
      label: INSIGHT_LABELS.unconfirmed_strikethrough,
      detail: `Пока ${history.length} ${pluralChecks(history.length)} — рано судить о реальной скидке`,
      minPrice,
      maxPrice,
      avgPrice,
    };
  }

  // Достаточная история: цена «до скидки» никогда не наблюдалась (±2%)
  if (strike && !strikeSeen && history.length >= FAKE_DISCOUNT_MIN_HISTORY) {
    return {
      kind: 'fake_discount',
      label: INSIGHT_LABELS.fake_discount,
      detail: `Цена «до скидки» ${formatRub(strike)} не встречалась за ${history.length} проверок (макс. в истории ${formatRub(maxPrice!)})`,
      minPrice,
      maxPrice,
      avgPrice,
    };
  }

  if (!minPrice || history.length < 2) {
    return {
      kind: 'average',
      label: 'Собираем историю',
      detail:
        'Пока одна проверка — цена как на этой карточке. График появится позже.',
      minPrice,
      maxPrice,
      avgPrice,
    };
  }

  if (currentPrice <= minPrice * 1.02) {
    return {
      kind: 'great_deal',
      label: INSIGHT_LABELS.great_deal,
      detail: `Минимум за всё время наблюдения: ${formatRub(minPrice)}`,
      minPrice,
      maxPrice,
      avgPrice,
    };
  }

  if (avgPrice && currentPrice < avgPrice * 0.97) {
    return {
      kind: 'good_price',
      label: INSIGHT_LABELS.good_price,
      detail: `Ниже средней (${formatRub(avgPrice)}) на ${Math.round((1 - currentPrice / avgPrice) * 100)}%`,
      minPrice,
      maxPrice,
      avgPrice,
    };
  }

  if (maxPrice && currentPrice >= maxPrice * 0.98) {
    return {
      kind: 'high_price',
      label: INSIGHT_LABELS.high_price,
      detail: `Близко к максимуму (${formatRub(maxPrice)}) — стоит подождать`,
      minPrice,
      maxPrice,
      avgPrice,
    };
  }

  return {
    kind: 'average',
    label: INSIGHT_LABELS.average,
    detail: avgPrice ? `Средняя цена: ${formatRub(avgPrice)}` : 'Цена в пределах обычного диапазона',
    minPrice,
    maxPrice,
    avgPrice,
  };
}

function pluralChecks(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'проверка';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'проверки';
  return 'проверок';
}

function formatRub(price: number): string {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    maximumFractionDigits: 0,
  }).format(price);
}

export function buildMiniChartSvg(history: PricePoint[], width = 280, height = 56): string {
  if (history.length < 2) {
    return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <text x="50%" y="50%" text-anchor="middle" fill="#94a3b8" font-size="11">Нужно ещё 1 проверка цены</text>
    </svg>`;
  }

  const chartPrices = history.map((p) => p.price);
  const min = Math.min(...chartPrices);
  const max = Math.max(...chartPrices);
  const range = max - min || 1;
  const pad = 6;

  const pts = history.map((point, i) => {
    const x = pad + (i / (history.length - 1)) * (width - pad * 2);
    const y = height - pad - ((point.price - min) / range) * (height - pad * 2);
    return `${x},${y}`;
  });

  const last = history[history.length - 1]!;
  const lastX = pad + ((history.length - 1) / (history.length - 1)) * (width - pad * 2);
  const lastY = height - pad - ((last.price - min) / range) * (height - pad * 2);

  return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">
    <defs>
      <linearGradient id="pg-fill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#4f46e5" stop-opacity="0.25"/>
        <stop offset="100%" stop-color="#4f46e5" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <polyline fill="none" stroke="#4f46e5" stroke-width="2" stroke-linecap="round" points="${pts.join(' ')}" />
    <polygon fill="url(#pg-fill)" points="${pad},${height - pad} ${pts.join(' ')} ${width - pad},${height - pad}" />
    <circle cx="${lastX}" cy="${lastY}" r="4" fill="#4f46e5" />
  </svg>`;
}
