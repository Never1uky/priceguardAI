/**
 * HTML-карточки и structured replies для Telegram product intel.
 */

import {
  escapeHtml,
  formatRub,
  marketplaceLabel,
  truncateTitle,
} from './telegram.ts';
import type {
  CheapOffer,
  FullProductAnalysisLike,
  ProductIntelCard,
} from './product-intel.ts';

const VERDICT_LABEL: Record<string, string> = {
  buy_now: 'Можно брать',
  wait_discount: 'Подождать скидку',
  not_recommended: 'Не рекомендуем',
};

export function productIntelKeyboard(productKey: string): Array<
  Array<{ text: string; callback_data: string } | { text: string; url: string }>
> {
  // callback_data max 64 bytes — короткий action + hash of key
  const ref = shortRef(productKey);
  return [
    [
      { text: '📊 Полный AI-анализ', callback_data: `pi:full:${ref}` },
      { text: '💰 Где дешевле', callback_data: `pi:cheap:${ref}` },
    ],
    [
      { text: '📈 История цены', callback_data: `pi:hist:${ref}` },
      { text: '⭐ Стоит ли покупать', callback_data: `pi:buy:${ref}` },
    ],
    [
      { text: '⚠ Недостатки', callback_data: `pi:cons:${ref}` },
      { text: '🆚 Аналоги', callback_data: `pi:analogs:${ref}` },
    ],
    [
      { text: '🔔 Следить за ценой', callback_data: `pi:watch:${ref}` },
      { text: '❓ Вопрос AI', callback_data: `pi:ask:${ref}` },
    ],
  ];
}

/** Короткая ссылка на session — сам product_key хранится в telegram_product_sessions */
export function shortRef(productKey: string): string {
  // Используем последние 24 символа key без двоеточия-префикса mp — укладываемся в 64
  const compact = productKey.replace(/^(wildberries|ozon|yandex_market):/, (_, mp: string) => {
    const map: Record<string, string> = {
      wildberries: 'w',
      ozon: 'o',
      yandex_market: 'y',
    };
    return `${map[mp] ?? 'x'}:`;
  });
  return compact.slice(0, 40);
}

export function expandShortRef(ref: string): string | null {
  const m = ref.match(/^([woy]):(.+)$/);
  if (!m) return null;
  const mp =
    m[1] === 'w' ? 'wildberries' : m[1] === 'o' ? 'ozon' : 'yandex_market';
  return `${mp}:${m[2]}`;
}

export function buildProductIntelCardMessage(card: ProductIntelCard): string {
  const title = escapeHtml(truncateTitle(card.title, 140));
  const mp = escapeHtml(marketplaceLabel(card.marketplace));
  const price =
    card.price != null && card.price > 0
      ? `<b>${formatRub(card.price)}</b>`
      : '—';
  const rating =
    card.rating != null && card.rating > 0
      ? `⭐ ${card.rating.toFixed(1)}`
      : '';

  const a = card.analysis;
  const score =
    a?.qualityScore != null
      ? `🧠 AI Score: <b>${Number(a.qualityScore).toFixed(1)}</b>/10`
      : '';
  const summary = a?.qualitySummary
    ? escapeHtml(truncateTitle(a.qualitySummary, 280))
    : a?.webOverview
      ? escapeHtml(truncateTitle(a.webOverview, 280))
      : '';

  const cacheBadge = card.fromCache
    ? '📦 <i>из AI Cache</i>'
    : card.analysisStatus === 'ready'
      ? '✨ <i>свежий AI-анализ</i>'
      : '';

  const dateLine =
    card.analyzedAt && Number.isFinite(card.analyzedAt)
      ? `📅 Анализ: ${escapeHtml(new Date(card.analyzedAt).toLocaleString('ru-RU'))}`
      : '';

  const offerLines = card.offers.slice(0, 3).map((o) => formatOfferLine(o));

  const lines = [
    '🛡 <b>PriceGuard · анализ товара</b>',
    '',
    `🛍 <b>${title}</b>`,
    `🏷 ${mp}${rating ? ` · ${rating}` : ''}`,
    `💰 ${price}`,
    score ? `\n${score}` : '',
    summary ? `\n${summary}` : '',
    cacheBadge ? `\n${cacheBadge}` : '',
    dateLine ? `\n${dateLine}` : '',
  ];

  if (offerLines.length) {
    lines.push('', '<b>Где ещё смотреть:</b>', ...offerLines);
  }

  if (card.analysisNote && card.analysisStatus !== 'ready') {
    lines.push('', `ℹ️ ${escapeHtml(card.analysisNote)}`);
  }

  if (!a && card.analysisStatus === 'missing') {
    lines.push(
      '',
      'Пришлите ссылку после анализа в Chrome — подтянем из AI Cache,',
      'или для WB запустим серверный анализ автоматически.',
    );
  }

  lines.push('', '⭐ <i>PriceGuard AI</i>');
  return lines.filter((l) => l !== '').join('\n');
}

function formatOfferLine(o: CheapOffer): string {
  const mp = escapeHtml(marketplaceLabel(o.marketplace));
  const price =
    o.price != null && o.price > 0 ? formatRub(o.price) : '—';
  const link = o.url?.startsWith('http')
    ? ` — <a href="${escapeHtml(o.url)}">открыть</a>`
    : '';
  return `• ${mp}: <b>${price}</b>${link}`;
}

function needAnalysis(a: FullProductAnalysisLike | null): string {
  return [
    '📭 AI-анализ ещё не готов для этого товара.',
    '',
    'Сделайте полный анализ в расширении или пришлите ссылку WB ещё раз.',
  ].join('\n');
}

export function renderFullAnalysis(a: FullProductAnalysisLike | null): string {
  if (!a) return needAnalysis(a);
  const score = a.qualityScore != null ? Number(a.qualityScore).toFixed(1) : '—';
  const verdict = VERDICT_LABEL[String(a.verdict ?? '')] ?? a.verdict ?? '—';
  const pros = (a.pros ?? []).slice(0, 5).map((p) => `• ${escapeHtml(p)}`);
  const cons = (a.cons ?? []).slice(0, 5).map((p) => `• ${escapeHtml(p)}`);
  return [
    '📊 <b>Полный AI-анализ</b>',
    '',
    `🧠 Score: <b>${score}</b>/10`,
    `⭐ Вердикт: <b>${escapeHtml(String(verdict))}</b>`,
    a.qualitySummary
      ? `\n${escapeHtml(truncateTitle(a.qualitySummary, 400))}`
      : '',
    a.webOverview
      ? `\n🗺 ${escapeHtml(truncateTitle(a.webOverview, 350))}`
      : '',
    pros.length ? `\n<b>Плюсы</b>\n${pros.join('\n')}` : '',
    cons.length ? `\n<b>Минусы</b>\n${cons.join('\n')}` : '',
    a.priceInsight
      ? `\n💡 ${escapeHtml(truncateTitle(a.priceInsight, 280))}`
      : '',
    '',
    '⭐ <i>из сохранённого анализа · без GPT</i>',
  ]
    .filter(Boolean)
    .join('\n');
}

export function renderVerdict(a: FullProductAnalysisLike | null): string {
  if (!a) return needAnalysis(a);
  const verdict = VERDICT_LABEL[String(a.verdict ?? '')] ?? a.verdict ?? '—';
  return [
    '⭐ <b>Стоит ли покупать</b>',
    '',
    `<b>${escapeHtml(String(verdict))}</b>`,
    a.verdictExplanation
      ? `\n${escapeHtml(truncateTitle(a.verdictExplanation, 900))}`
      : '',
    a.qualityScore != null
      ? `\n🧠 Score: <b>${Number(a.qualityScore).toFixed(1)}</b>/10`
      : '',
    '',
    '⭐ <i>из сохранённого анализа</i>',
  ]
    .filter(Boolean)
    .join('\n');
}

export function renderCons(a: FullProductAnalysisLike | null): string {
  if (!a) return needAnalysis(a);
  const cons = (a.cons ?? []).map((c) => `• ${escapeHtml(c)}`);
  const hidden = (a.hiddenProblems ?? []).map((c) => `• ${escapeHtml(c)}`);
  if (!cons.length && !hidden.length) {
    return '⚠ В сохранённом анализе нет списка недостатков.';
  }
  return [
    '⚠ <b>Недостатки</b>',
    '',
    cons.length ? cons.join('\n') : '',
    hidden.length ? `\n<b>Скрытые риски</b>\n${hidden.join('\n')}` : '',
    a.fakeRisk
      ? `\n🎭 Риск фейка: <b>${escapeHtml(String(a.fakeRisk))}</b>`
      : '',
    a.fakeRiskExplanation
      ? `\n${escapeHtml(truncateTitle(a.fakeRiskExplanation, 400))}`
      : '',
    '',
    '⭐ <i>из сохранённого анализа · без GPT</i>',
  ]
    .filter(Boolean)
    .join('\n');
}

export function renderAnalogs(a: FullProductAnalysisLike | null): string {
  if (!a) return needAnalysis(a);
  const alts = (a.alternatives ?? []).slice(0, 5).map((x) => {
    const name = escapeHtml(String(x.name ?? 'Аналог'));
    const reason = x.reason ? ` — ${escapeHtml(truncateTitle(x.reason, 160))}` : '';
    return `• <b>${name}</b>${reason}`;
  });
  if (!alts.length && !a.analogComparison) {
    return [
      '🆚 Аналоги в AI-анализе не найдены.',
      '',
      'Полный поиск по площадкам — во вкладке Compare расширения.',
    ].join('\n');
  }
  return [
    '🆚 <b>Аналоги</b>',
    '',
    a.analogComparison
      ? escapeHtml(truncateTitle(a.analogComparison, 500))
      : '',
    alts.length ? `\n${alts.join('\n')}` : '',
    '',
    '⭐ <i>из сохранённого анализа</i>',
  ]
    .filter(Boolean)
    .join('\n');
}

export function renderCheaper(
  cardTitle: string,
  sourcePrice: number | null,
  offers: CheapOffer[],
): string {
  if (!offers.length) {
    return [
      '💰 <b>Где дешевле</b>',
      '',
      'Пока нет известных соответствий на других площадках.',
      '',
      'Сделайте сравнение в расширении (Compare) — mapping наполнится,',
      'и бот сможет показывать цены здесь.',
    ].join('\n');
  }
  const lines = offers.slice(0, 5).map((o) => formatOfferLine(o));
  const src =
    sourcePrice != null && sourcePrice > 0
      ? `\nСейчас у вас: <b>${formatRub(sourcePrice)}</b>`
      : '';
  return [
    '💰 <b>Где дешевле</b>',
    '',
    `🛍 ${escapeHtml(truncateTitle(cardTitle, 100))}${src}`,
    '',
    ...lines,
    '',
    '⭐ <i>cross-market mapping · без SERP</i>',
  ].join('\n');
}

export function renderHistory(input: {
  title: string;
  lastPrice: number | null;
  lastChecked: string | null;
  tracked: boolean;
  points?: Array<{ price: number; recordedAt: string }>;
}): string {
  const points = input.points ?? [];
  if (points.length > 0) {
    const lines = points.slice(-15).map((p) => {
      const d = new Date(p.recordedAt);
      const label = Number.isFinite(d.getTime())
        ? d.toLocaleString('ru-RU', {
          day: '2-digit',
          month: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        })
        : p.recordedAt;
      return `• ${escapeHtml(label)} — <b>${formatRub(p.price)}</b>`;
    });
    const first = points[0]!.price;
    const last = points[points.length - 1]!.price;
    const delta = last - first;
    const deltaLine =
      points.length >= 2
        ? `\nΔ за период: <b>${delta >= 0 ? '+' : ''}${formatRub(delta)}</b>`
        : '';
    return [
      '📈 <b>История цены</b>',
      '',
      `🛍 ${escapeHtml(truncateTitle(input.title, 100))}`,
      '',
      ...lines,
      deltaLine,
      '',
      '⭐ <i>облачная история</i>',
    ]
      .filter(Boolean)
      .join('\n');
  }

  if (!input.tracked) {
    return [
      '📈 <b>История цены</b>',
      '',
      'Пока нет точек в облаке.',
      'Нажмите «🔔 Следить за ценой» — сервер начнёт копить историю.',
      'Полный график — в расширении PriceGuard.',
    ].join('\n');
  }
  const price =
    input.lastPrice != null && input.lastPrice > 0
      ? formatRub(input.lastPrice)
      : '—';
  const checked = input.lastChecked
    ? new Date(input.lastChecked).toLocaleString('ru-RU')
    : '—';
  return [
    '📈 <b>История цены</b>',
    '',
    `🛍 ${escapeHtml(truncateTitle(input.title, 100))}`,
    `💰 Последняя цена: <b>${price}</b>`,
    `🕒 Проверка: ${escapeHtml(checked)}`,
    '',
    'Точки появятся после следующих серверных проверок.',
  ].join('\n');
}

/** Intent router: ответ из analysis без LLM, иначе null */
export function matchStructuredIntent(
  text: string,
  a: FullProductAnalysisLike | null,
): string | null {
  const t = text.toLowerCase().replace(/\s+/g, ' ').trim();

  if (/недостат|минус|плох|риск|фейк|обман/.test(t)) {
    return renderCons(a);
  }
  if (/стоит ли|покупать|вердикт|рекоменд/.test(t)) {
    return renderVerdict(a);
  }
  if (/аналог|альтернатив|что лучше|похож/.test(t)) {
    return renderAnalogs(a);
  }
  if (/оценка|score|почему.*(8|9|10|\d)|балл/.test(t)) {
    if (!a) return needAnalysis(a);
    return [
      '🧠 <b>Почему такая оценка</b>',
      '',
      a.qualityScore != null
        ? `Score: <b>${Number(a.qualityScore).toFixed(1)}</b>/10`
        : '',
      a.qualitySummary
        ? `\n${escapeHtml(truncateTitle(a.qualitySummary, 400))}`
        : '',
      a.verdictExplanation
        ? `\n${escapeHtml(truncateTitle(a.verdictExplanation, 400))}`
        : '',
      '',
      '⭐ <i>из сохранённого анализа · без GPT</i>',
    ]
      .filter(Boolean)
      .join('\n');
  }
  if (/преимущ|плюс|хорош/.test(t)) {
    if (!a) return needAnalysis(a);
    const pros = (a.pros ?? []).map((p) => `• ${escapeHtml(p)}`);
    if (!pros.length) return 'В анализе нет списка преимуществ.';
    return [
      '✅ <b>Преимущества</b>',
      '',
      ...pros,
      '',
      '⭐ <i>из сохранённого анализа</i>',
    ].join('\n');
  }
  return null;
}

export function buildCompactAnalysisContext(a: FullProductAnalysisLike): string {
  return JSON.stringify({
    score: a.qualityScore,
    summary: a.qualitySummary?.slice(0, 220),
    verdict: a.verdict,
    verdictExplanation: a.verdictExplanation?.slice(0, 280),
    pros: (a.pros ?? []).slice(0, 4),
    cons: (a.cons ?? []).slice(0, 4),
    alternatives: (a.alternatives ?? []).slice(0, 3),
    priceInsight: a.priceInsight?.slice(0, 180),
    hiddenProblems: (a.hiddenProblems ?? []).slice(0, 3),
  });
}
