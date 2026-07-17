/**
 * HTML-тексты TG-алертов (клиент). Дублируют supabase/functions/_shared/telegram.ts
 * — передаём как message fallback, если Edge ещё не знает новый type.
 */

import { COMPARISON_MARKETPLACE_LABELS } from '@/types/comparison';
import type { Marketplace } from '@/types/product';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatRub(n: number): string {
  return new Intl.NumberFormat('ru-RU').format(Math.round(n)) + ' ₽';
}

function truncateTitle(title: string, max = 120): string {
  const t = title.trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1) + '…';
}

function mpLabel(marketplace: Marketplace | string): string {
  return (
    COMPARISON_MARKETPLACE_LABELS[marketplace as keyof typeof COMPARISON_MARKETPLACE_LABELS] ??
    String(marketplace)
  );
}

/** Снижение цены на той же площадке в сравнении */
export function buildComparePriceDropTelegramMessage(input: {
  title: string;
  oldPrice: number;
  newPrice: number;
  marketplace: Marketplace | string;
}): string {
  const title = escapeHtml(truncateTitle(input.title));
  const drop = input.oldPrice - input.newPrice;
  const pct =
    input.oldPrice > 0 ? Math.round((drop / input.oldPrice) * 1000) / 10 : 0;
  const mp = escapeHtml(mpLabel(input.marketplace));

  return [
    `📉 <b>Снижение цены на ${mp}</b>`,
    '',
    `🛍 <b>${title}</b>`,
    `🏷 ${mp}`,
    '',
    `💸 Было: <s>${formatRub(input.oldPrice)}</s>`,
    `✅ Стало: <b>${formatRub(input.newPrice)}</b>`,
    `📊 Выгода: <b>−${formatRub(drop)}</b> (−${pct}%)`,
    '',
    '⭐ <i>PriceGuard AI</i>',
  ].join('\n');
}

/** Нашли дешевле на другой площадке */
export function buildCheaperElsewhereTelegramMessage(input: {
  title: string;
  sourceMarketplace: Marketplace | string;
  sourcePrice: number;
  cheaperMarketplace: Marketplace | string;
  cheaperPrice: number;
}): string {
  const title = escapeHtml(truncateTitle(input.title));
  const sourceMp = escapeHtml(mpLabel(input.sourceMarketplace));
  const cheapMp = escapeHtml(mpLabel(input.cheaperMarketplace));
  const drop = input.sourcePrice - input.cheaperPrice;
  const pct =
    input.sourcePrice > 0 ? Math.round((drop / input.sourcePrice) * 1000) / 10 : 0;

  return [
    '💸 <b>Нашли дешевле на другой площадке!</b>',
    '',
    `🛍 <b>${title}</b>`,
    '',
    `📍 Источник: ${sourceMp} · ${formatRub(input.sourcePrice)}`,
    `✅ Дешевле: <b>${cheapMp}</b> · <b>${formatRub(input.cheaperPrice)}</b>`,
    `📊 Выгода: <b>−${formatRub(drop)}</b> (−${pct}%)`,
    '',
    '⭐ <i>PriceGuard AI</i>',
  ].join('\n');
}

export function openOnMarketplaceButtonText(marketplace: Marketplace | string): string {
  return `🛒 Открыть на ${mpLabel(marketplace)}`;
}
