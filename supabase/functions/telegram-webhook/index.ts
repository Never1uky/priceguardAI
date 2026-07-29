// Webhook @PriceGuardAlertsBot
// Команды: /start /help /chatid /status /add
// Ссылка на товар → product-intel карточка + inline keyboard
// Secrets: TELEGRAM_BOT_TOKEN, SUPABASE_SERVICE_ROLE_KEY

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { jsonResponse } from '../_shared/utils.ts';
import { fetchMarketplacePrice, fetchMarketplacePriceDetailed } from '../_shared/marketplace-prices.ts';
import { parseProductLinkFromText, type Marketplace } from '../_shared/product-url.ts';
import { upsertTrackedProduct } from '../_shared/tracked-upsert.ts';
import { parseProductKey, productKey, productIdLookupCandidates } from '../_shared/product-id.ts';
import { runProductIntel, loadAnalysisForKey, lookupCheapOffers } from '../_shared/product-intel.ts';
import { projectScraperCredentials } from '../_shared/reviews-common.ts';
import { loadPriceHistory } from '../_shared/price-history.ts';
import { isPremiumRowActive } from '../_shared/premium-active.ts';
import { loadPriceMins, formatMinStatusLine } from '../_shared/price-mins.ts';
import {
  resolveCachedCompareOffers,
  renderCachedCompareMessage,
  compareResultKeyboard,
} from '../_shared/compare-cache-read.ts';
import {
  buildFaqRootMessage,
  buildFaqAnswer,
  faqRootKeyboard,
  faqBackKeyboard,
  faqDigestKeyboard,
} from '../_shared/alerts-faq.ts';
import {
  buildProductIntelCardMessage,
  productIntelKeyboard,
  expandShortRef,
  shortRef,
  renderFullAnalysis,
  renderVerdict,
  renderCons,
  renderAnalogs,
  renderCheaper,
  renderHistory,
  matchStructuredIntent,
  buildCompactAnalysisContext,
} from '../_shared/product-intel-render.ts';
import {
  buildHelpMessage,
  buildProductAddedMessage,
  buildStartWelcomeMessage,
  buildStatusMessage,
  buildTrackedItemCardMessage,
  trackedItemInlineKeyboard,
  alertsMainReplyKeyboard,
  REPLY_BTN_STATUS,
  REPLY_BTN_AI,
  REPLY_BTN_FAQ,
  REPLY_BTN_HELP,
  escapeHtml,
  truncateTitle,
  matchFaqReply,
  sendTelegramMessage,
  sendTelegramPhoto,
  answerTelegramCallback,
  CHROME_WEB_STORE_URL,
} from '../_shared/telegram.ts';

interface TelegramUpdate {
  message?: {
    chat?: { id?: number };
    text?: string;
  };
  callback_query?: {
    id?: string;
    data?: string;
    message?: {
      chat?: { id?: number };
      message_id?: number;
    };
    from?: { id?: number };
  };
}

const pendingAddByChat = new Map<string, number>();
const PENDING_TTL_MS = 15 * 60 * 1000;
const FREE_TRACK_LIMIT = 5;
const PREMIUM_TRACK_LIMIT = 50;
const STATUS_CARD_LIMIT = 5;
/** Free: min interval between AI refresh per product */
const FREE_AI_REFRESH_MS = 6 * 60 * 60 * 1000;
const aiRefreshAtByKey = new Map<string, number>();

type TrackedRow = {
  title: string;
  marketplace: string | null;
  productId: string;
  productUrl: string | null;
  lastPrice: number | null;
  targetPrice: number | null;
  lastChecked: string | null;
  lastFetchError: string | null;
};

function serviceClient(): SupabaseClient | null {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return null;
  return createClient(url, key);
}

function resolveBotToken(): string | null {
  return (
    Deno.env.get('TELEGRAM_BOT_TOKEN')?.trim() ||
    Deno.env.get('TELEGRAM_ALERTS_BOT_TOKEN')?.trim() ||
    null
  );
}

function setPendingAdd(chatId: string) {
  pendingAddByChat.set(chatId, Date.now());
}

function takePendingAdd(chatId: string): boolean {
  const at = pendingAddByChat.get(chatId);
  if (at == null) return false;
  pendingAddByChat.delete(chatId);
  return Date.now() - at <= PENDING_TTL_MS;
}

function clearPendingAdd(chatId: string) {
  pendingAddByChat.delete(chatId);
}

async function sendTyping(chatId: string) {
  const token = resolveBotToken();
  if (!token) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendChatAction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, action: 'typing' }),
    });
  } catch {
    // ignore
  }
}

async function getBotIdentity(token: string) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const body = await res.json() as {
      ok?: boolean;
      description?: string;
      result?: { id?: number; username?: string };
    };
    if (!body.ok || !body.result) {
      return { ok: false as const, error: body.description ?? `HTTP ${res.status}` };
    }
    return {
      ok: true as const,
      id: body.result.id,
      username: body.result.username,
    };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function resolveUserId(
  supabase: SupabaseClient,
  chatId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('user_alert_settings')
    .select('user_id, telegram_enabled, server_monitoring, updated_at')
    .eq('telegram_chat_id', chatId)
    .order('updated_at', { ascending: false })
    .limit(5);

  if (error) {
    console.error('[telegram-webhook] resolveUserId', error);
    return null;
  }

  const rows = data ?? [];
  if (rows.length === 0) return null;

  const active =
    rows.find((r) => r.telegram_enabled && r.server_monitoring) ??
    rows.find((r) => r.telegram_enabled) ??
    rows[0];

  return active?.user_id ?? null;
}

async function loadTrackedForUser(supabase: SupabaseClient, userId: string): Promise<TrackedRow[]> {
  const { data: rows, error } = await supabase
    .from('tracked_products')
    .select(
      'product_title, marketplace, product_id, product_url, last_price, target_price, last_checked, last_fetch_error',
    )
    .eq('user_id', userId)
    .eq('deleted', false)
    .order('updated_at', { ascending: false })
    .limit(40);

  if (error) {
    console.error('[telegram-webhook] status', error);
    return [];
  }

  return (rows ?? []).map((r) => ({
    title: String(r.product_title ?? 'Товар'),
    marketplace: (r.marketplace as string | null) ?? null,
    productId: String(r.product_id ?? ''),
    productUrl: (r.product_url as string | null) ?? null,
    lastPrice: r.last_price == null ? null : Number(r.last_price),
    targetPrice: r.target_price == null ? null : Number(r.target_price),
    lastChecked: (r.last_checked as string | null) ?? null,
    lastFetchError: (r.last_fetch_error as string | null) ?? null,
  }));
}

function statusPageKeyboard(page: number, total: number): Array<
  Array<{ text: string; callback_data: string }>
> | undefined {
  const totalPages = Math.max(1, Math.ceil(total / STATUS_CARD_LIMIT));
  if (totalPages <= 1) return undefined;
  const row: Array<{ text: string; callback_data: string }> = [];
  if (page > 0) {
    row.push({ text: '⬅️ Назад', callback_data: `st:page:${page - 1}` });
  }
  const remaining = Math.max(0, total - (page + 1) * STATUS_CARD_LIMIT);
  if (remaining > 0) {
    row.push({
      text: `Ещё ${Math.min(STATUS_CARD_LIMIT, remaining)} →`,
      callback_data: `st:page:${page + 1}`,
    });
  }
  return row.length ? [row] : undefined;
}

async function sendStatusCards(
  supabase: SupabaseClient,
  chatId: string,
  userId: string,
  premium: boolean,
  page = 0,
): Promise<void> {
  const all = await loadTrackedForUser(supabase, userId);
  const total = all.length;
  const trackCap = premium ? PREMIUM_TRACK_LIMIT : FREE_TRACK_LIMIT;
  // Free: only first page (≤5). Premium: paginate within trackCap for monitoring parity.
  const maxVisible = Math.min(total, trackCap);
  const totalPages = Math.max(1, Math.ceil(maxVisible / STATUS_CARD_LIMIT));
  const safePage = Math.max(0, Math.min(page, totalPages - 1));
  const start = safePage * STATUS_CARD_LIMIT;
  const cards = all.slice(start, start + STATUS_CARD_LIMIT);

  if (total === 0) {
    await sendTelegramMessage({
      chatId,
      text: [
        buildStatusMessage([], {
          totalCount: 0,
          freeLimit: trackCap,
        }),
        '',
        'Если товары есть в расширении, но здесь пусто:',
        '• откройте «Список» в popup (синхронизация)',
        '• «Подключить и проверить» после входа',
        '• или пришлите ссылку / /add',
      ].join('\n'),
      replyKeyboard: alertsMainReplyKeyboard(),
    });
    return;
  }

  const shownFrom = start + 1;
  const shownTo = start + cards.length;
  const header = premium
    ? safePage === 0
      ? `📋 <b>Мои товары</b> · ${shownFrom}–${shownTo} из ${maxVisible} (лимит ${PREMIUM_TRACK_LIMIT})${
          total > PREMIUM_TRACK_LIMIT ? ` · на сервере ${total}` : ''
        }`
      : `📋 <b>Страница ${safePage + 1}</b> · ${shownFrom}–${shownTo} из ${maxVisible}`
    : `📋 <b>Мои товары</b> · ${Math.min(total, FREE_TRACK_LIMIT)} из ${FREE_TRACK_LIMIT} (мониторинг)${
        total > FREE_TRACK_LIMIT ? ` · на сервере ${total}` : ''
      }`;

  const nav = premium && maxVisible > STATUS_CARD_LIMIT
    ? statusPageKeyboard(safePage, maxVisible)
    : undefined;
  const hint =
    premium && total > STATUS_CARD_LIMIT && safePage === 0
      ? 'Листайте страницами ниже · кнопки: анализ · сравнение · удалить.'
      : safePage === 0
        ? 'Кнопки под каждым товаром: анализ · сравнение · удалить.'
        : `Ещё ${Math.max(0, maxVisible - shownTo)} в следующих страницах.`;

  await sendTelegramMessage({
    chatId,
    text: [header, '', hint].filter(Boolean).join('\n'),
    replyKeyboard: safePage === 0 ? alertsMainReplyKeyboard() : undefined,
    inlineKeyboard: nav,
  });

  for (const item of cards) {
    if (!item.marketplace || !item.productId) continue;
    const mp = item.marketplace as Marketplace;
    if (mp !== 'wildberries' && mp !== 'ozon' && mp !== 'yandex_market') continue;
    const key = productKey(mp, item.productId);
    const ref = shortRef(key);
    const mins = await loadPriceMins(supabase, {
      userId,
      marketplace: mp,
      productId: item.productId,
    });
    const minLine = formatMinStatusLine(item.lastPrice, mins);
    await sendTelegramMessage({
      chatId,
      text: buildTrackedItemCardMessage({ ...item, minLine }),
      inlineKeyboard: trackedItemInlineKeyboard(ref),
    });
  }

  // Footer nav after cards (easier to tap after reading the page)
  if (nav) {
    await sendTelegramMessage({
      chatId,
      text: `📄 Стр. ${safePage + 1}/${totalPages}`,
      inlineKeyboard: nav,
    });
  }
}

async function isPremiumUser(supabase: SupabaseClient, userId: string): Promise<boolean> {
  const { data } = await supabase
    .from('user_premium')
    .select('user_id, expires_at, license_key_id, license_keys(is_active, expires_at)')
    .eq('user_id', userId)
    .maybeSingle();
  return isPremiumRowActive(data);
}

async function upsertSession(
  supabase: SupabaseClient,
  params: {
    chatId: string;
    userId: string | null;
    marketplace: string;
    productId: string;
    productKey: string;
    productUrl: string;
    productTitle: string;
    mode?: 'card' | 'ai_chat';
  },
) {
  const { error } = await supabase.from('telegram_product_sessions').upsert(
    {
      chat_id: params.chatId,
      user_id: params.userId,
      marketplace: params.marketplace,
      product_id: params.productId,
      product_key: params.productKey,
      product_url: params.productUrl,
      product_title: params.productTitle,
      mode: params.mode ?? 'card',
      last_card_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'chat_id' },
  );
  if (error) {
    console.error('[telegram-webhook] upsertSession', error.message);
  }
}

async function getSession(supabase: SupabaseClient, chatId: string) {
  const { data, error } = await supabase
    .from('telegram_product_sessions')
    .select('*')
    .eq('chat_id', chatId)
    .maybeSingle();
  if (error) {
    console.error('[telegram-webhook] getSession', error.message);
    return null;
  }
  return data;
}

async function setSessionMode(
  supabase: SupabaseClient,
  chatId: string,
  mode: 'card' | 'ai_chat',
) {
  const { error } = await supabase
    .from('telegram_product_sessions')
    .update({ mode, updated_at: new Date().toISOString() })
    .eq('chat_id', chatId);
  if (error) {
    console.error('[telegram-webhook] setSessionMode', error.message);
  }
}

async function addProductFromLink(
  supabase: SupabaseClient,
  userId: string,
  text: string,
): Promise<{
  ok: boolean;
  reply: string;
  buttonUrl?: string;
}> {
  const parsed = parseProductLinkFromText(text);
  if (!parsed) {
    return {
      ok: false,
      reply: [
        '🔗 Не распознал товарную ссылку.',
        '',
        'Формат: <code>/add https://…</code>',
        '• wildberries.ru/catalog/…',
        '• ozon.ru/product/…',
        '• market.yandex.ru/card/…/…',
      ].join('\n'),
    };
  }

  const premium = await isPremiumUser(supabase, userId);
  const trackCap = premium ? PREMIUM_TRACK_LIMIT : FREE_TRACK_LIMIT;
  const { data: existing } = await supabase
    .from('tracked_products')
    .select('id')
    .eq('user_id', userId)
    .eq('marketplace', parsed.marketplace)
    .eq('product_id', parsed.productId)
    .eq('deleted', false)
    .maybeSingle();

  if (!existing) {
    const { count } = await supabase
      .from('tracked_products')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('deleted', false);

    if ((count ?? 0) >= trackCap) {
      return {
        ok: false,
        reply: [
          premium
            ? `📦 Лимит Premium: до <b>${PREMIUM_TRACK_LIMIT}</b> товаров.`
            : `📦 Лимит Free: до <b>${FREE_TRACK_LIMIT}</b> товаров.`,
          '',
          premium
            ? 'Удалите товар в расширении → «Мои товары» или в боте.'
            : 'Удалите товар в расширении → «Список» или оформите Premium (до 50).',
        ].join('\n'),
        buttonUrl: parsed.url,
      };
    }
  }

  const fetched = await fetchMarketplacePriceDetailed(
    parsed.marketplace,
    parsed.productId,
    parsed.url,
    { supabase, scraper: projectScraperCredentials() },
  );

  const title = (fetched?.title || parsed.titleHint || 'Товар').slice(0, 500);
  const nowIso = new Date().toISOString();
  const price = fetched?.price && fetched.price > 0 ? fetched.price : null;
  const url = fetched?.url || parsed.url;

  const saved = await upsertTrackedProduct(supabase, {
    userId,
    marketplace: parsed.marketplace,
    productId: parsed.productId,
    productTitle: title,
    productUrl: url,
    lastPrice: price,
    lastChecked: price != null ? nowIso : null,
    deleted: false,
    updatedAt: nowIso,
  });

  if (!saved.ok) {
    console.error('[telegram-webhook] upsert tracked', saved);
    return {
      ok: false,
      reply: [
        '⚠️ Не удалось сохранить товар.',
        saved.code ? `<code>${escapeHtml(saved.code)}</code>` : '',
        'Проверьте вход в расширении и синхронизацию списка.',
      ].filter(Boolean).join('\n'),
    };
  }

  if (price == null) {
    const mpLabel =
      parsed.marketplace === 'yandex_market'
        ? 'Яндекс Маркет'
        : parsed.marketplace === 'ozon'
          ? 'Ozon'
          : 'Wildberries';
    return {
      ok: true,
      reply: [
        '✅ <b>Товар добавлен</b> (цена с сервера недоступна)',
        '',
        `🛍 <b>${escapeHtml(title)}</b>`,
        `🏷 ${mpLabel}`,
        '',
        'Откройте эту карточку в браузере с расширением PriceGuard —',
        'название и цена подтянутся автоматически.',
        '',
        'Список: /status',
      ].join('\n'),
      buttonUrl: url,
    };
  }

  return {
    ok: true,
    reply: buildProductAddedMessage({
      title,
      price,
      marketplace: parsed.marketplace,
      priceSource: fetched.source === 'cache' ? 'cache' : 'server',
    }),
    buttonUrl: url,
  };
}

async function removeProductFromLink(
  supabase: SupabaseClient,
  userId: string,
  text: string,
): Promise<{ ok: boolean; reply: string }> {
  const parsed = parseProductLinkFromText(text);
  if (!parsed) {
    return {
      ok: false,
      reply: [
        '🔗 Не распознал товарную ссылку.',
        '',
        'Формат: <code>/remove https://…</code>',
      ].join('\n'),
    };
  }

  const nowIso = new Date().toISOString();
  const saved = await upsertTrackedProduct(supabase, {
    userId,
    marketplace: parsed.marketplace,
    productId: parsed.productId,
    deleted: true,
    updatedAt: nowIso,
  });

  if (!saved.ok) {
    return {
      ok: false,
      reply: '⚠️ Не удалось убрать товар из отслеживания.',
    };
  }

  return {
    ok: true,
    reply: [
      '✅ <b>Товар убран из отслеживания</b>',
      '',
      `🛍 ${escapeHtml(truncateTitle(parsed.titleHint || 'Товар', 80))}`,
      '',
      'Список: /status',
    ].join('\n'),
  };
}

async function handleProductLink(
  supabase: SupabaseClient,
  chatId: string,
  text: string,
): Promise<{ action: string; sent: boolean; error?: string | null }> {
  const parsed = parseProductLinkFromText(text);
  if (!parsed) {
    return { action: 'ignored', sent: false };
  }

  await sendTyping(chatId);
  await sendTelegramMessage({
    chatId,
    text: '⏳ <b>Смотрю товар…</b>\nЦена, AI Cache, предложения на других площадках.',
  });

  const userId = await resolveUserId(supabase, chatId);
  const premium = userId ? await isPremiumUser(supabase, userId) : false;

  const card = await runProductIntel({
    supabase,
    parsed,
    chatId,
    userId,
    isPremium: premium,
    allowGenerate: true,
  });

  await upsertSession(supabase, {
    chatId,
    userId,
    marketplace: card.marketplace,
    productId: card.productId,
    productKey: card.productKey,
    productUrl: card.url,
    productTitle: card.title,
    mode: 'card',
  });

  const keyboard = productIntelKeyboard(card.productKey);
  if (card.url.startsWith('http')) {
    keyboard.push([{ text: '🛒 Открыть товар', url: card.url }]);
  }

  let cardText = buildProductIntelCardMessage(card);
  if (premium && card.analysisStatus === 'ready' && !card.fromCache) {
    cardText += '\n👑 <i>Premium full analysis</i>';
  }

  let result;
  if (card.imageUrl?.startsWith('http')) {
    const photoResult = await sendTelegramPhoto({
      chatId,
      photoUrl: card.imageUrl,
      caption: cardText.slice(0, 1024),
      inlineKeyboard: keyboard,
    });
    if (photoResult.sent) {
      result = photoResult;
    } else {
      console.warn('[telegram-webhook] sendPhoto failed', photoResult.error);
      result = await sendTelegramMessage({
        chatId,
        text: cardText,
        inlineKeyboard: keyboard,
      });
    }
  } else {
    result = await sendTelegramMessage({
      chatId,
      text: cardText,
      inlineKeyboard: keyboard,
    });
  }

  return {
    action: 'product_intel',
    sent: result.sent,
    error: result.error ?? null,
  };
}

async function resolveProductKeyFromCallback(
  supabase: SupabaseClient,
  chatId: string,
  ref: string,
): Promise<string | null> {
  const fromRef = expandShortRef(ref);
  // Prefer explicit ref (status cards) over whatever session is open
  if (fromRef) return fromRef;
  const session = await getSession(supabase, chatId);
  return session?.product_key ? String(session.product_key) : null;
}

async function ensureSessionForProduct(
  supabase: SupabaseClient,
  chatId: string,
  userId: string | null,
  productKeyStr: string,
  title?: string,
  url?: string | null,
) {
  const parsed = parseProductKey(productKeyStr);
  if (!parsed) return;
  await upsertSession(supabase, {
    chatId,
    userId,
    marketplace: parsed.marketplace,
    productId: parsed.productId,
    productKey: productKeyStr,
    productUrl: url?.trim() || '',
    productTitle: title || 'Товар',
    mode: 'card',
  });
}

async function findTrackedRow(
  supabase: SupabaseClient,
  userId: string,
  marketplace: Marketplace,
  productId: string,
): Promise<{
  product_title: string | null;
  product_url: string | null;
  last_price: number | null;
  last_checked: string | null;
  deleted: boolean;
  product_id: string;
} | null> {
  const candidates = productIdLookupCandidates(marketplace, productId);
  if (candidates.length === 0) return null;
  const { data } = await supabase
    .from('tracked_products')
    .select('product_title, product_url, last_price, last_checked, deleted, product_id')
    .eq('user_id', userId)
    .eq('marketplace', marketplace)
    .in('product_id', candidates)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return {
    product_title: (data.product_title as string | null) ?? null,
    product_url: (data.product_url as string | null) ?? null,
    last_price: data.last_price == null ? null : Number(data.last_price),
    last_checked: (data.last_checked as string | null) ?? null,
    deleted: Boolean(data.deleted),
    product_id: String(data.product_id ?? productId),
  };
}

async function handleFaqCallback(
  supabase: SupabaseClient,
  chatId: string,
  data: string,
): Promise<{ action: string }> {
  const topic = data.slice('faq:'.length);
  if (topic === 'root') {
    await sendTelegramMessage({
      chatId,
      text: buildFaqRootMessage(),
      inlineKeyboard: faqRootKeyboard(),
    });
    return { action: 'faq_root' };
  }
  if (topic === 'digest') {
    const userId = await resolveUserId(supabase, chatId);
    let enabled = false;
    if (userId) {
      const { data: row } = await supabase
        .from('user_alert_settings')
        .select('digest_enabled')
        .eq('user_id', userId)
        .maybeSingle();
      enabled = Boolean(row?.digest_enabled);
    }
    await sendTelegramMessage({
      chatId,
      text: buildFaqAnswer('digest') ?? 'Дайджест',
      inlineKeyboard: faqDigestKeyboard(enabled),
    });
    return { action: 'faq_digest' };
  }
  const answer = buildFaqAnswer(topic);
  if (!answer) {
    await sendTelegramMessage({ chatId, text: 'Тема FAQ не найдена.', inlineKeyboard: faqRootKeyboard() });
    return { action: 'faq_unknown' };
  }
  await sendTelegramMessage({
    chatId,
    text: answer,
    inlineKeyboard: faqBackKeyboard(),
  });
  return { action: `faq_${topic}` };
}

async function handleStatusCallback(
  supabase: SupabaseClient,
  chatId: string,
  data: string,
): Promise<{ action: string }> {
  // st:page:N | st:ai:ref | st:ai_refresh:ref | st:cmp:ref | st:rm:ref | st:rmok:ref | st:rmno:ref | st:digest_on|off
  const pageMatch = data.match(/^st:page:(\d+)$/);
  if (pageMatch) {
    const page = Number(pageMatch[1]);
    const userId = await resolveUserId(supabase, chatId);
    if (!userId) {
      await sendTelegramMessage({ chatId, text: NOT_LINKED(Number(chatId) || chatId) });
      return { action: 'st_page_unlink' };
    }
    const premium = await isPremiumUser(supabase, userId);
    if (!premium) {
      await sendStatusCards(supabase, chatId, userId, false, 0);
      return { action: 'st_page_free' };
    }
    await sendStatusCards(supabase, chatId, userId, true, Number.isFinite(page) ? page : 0);
    return { action: 'st_page' };
  }

  if (data === 'st:digest_on' || data === 'st:digest_off') {
    const userId = await resolveUserId(supabase, chatId);
    if (!userId) {
      await sendTelegramMessage({ chatId, text: NOT_LINKED(Number(chatId) || chatId) });
      return { action: 'digest_unlink' };
    }
    const enabled = data === 'st:digest_on';
    const { error } = await supabase
      .from('user_alert_settings')
      .update({ digest_enabled: enabled, updated_at: new Date().toISOString() })
      .eq('user_id', userId);
    if (error) {
      console.error('[telegram-webhook] digest toggle', error);
      await sendTelegramMessage({ chatId, text: 'Не удалось сохранить настройку дайджеста.' });
      return { action: 'digest_error' };
    }
    await sendTelegramMessage({
      chatId,
      text: enabled
        ? '🔔 Утренний дайджест включён (около 09:00 МСК).'
        : '🔕 Утренний дайджест выключен.',
      inlineKeyboard: faqDigestKeyboard(enabled),
    });
    return { action: enabled ? 'digest_on' : 'digest_off' };
  }

  const m = data.match(/^st:(ai_refresh|ai|cmp|rmok|rmno|rm):(.+)$/);
  if (!m) {
    await sendTelegramMessage({ chatId, text: 'Неизвестная кнопка.' });
    return { action: 'st_unknown' };
  }
  const action = m[1]!;
  const ref = m[2]!;
  const productKeyStr = await resolveProductKeyFromCallback(supabase, chatId, ref);
  if (!productKeyStr) {
    await sendTelegramMessage({
      chatId,
      text: 'Не удалось определить товар. Откройте «Мои товары» ещё раз.',
    });
    return { action: 'st_no_key' };
  }
  const parsedKey = parseProductKey(productKeyStr);
  if (!parsedKey) {
    await sendTelegramMessage({ chatId, text: 'Некорректный товар.' });
    return { action: 'st_bad_key' };
  }

  const userId = await resolveUserId(supabase, chatId);
  const tracked = userId
    ? await findTrackedRow(supabase, userId, parsedKey.marketplace, parsedKey.productId)
    : null;

  const title = String(tracked?.product_title ?? 'Товар');
  const url = tracked?.product_url ? String(tracked.product_url) : null;
  const trackedProductId = tracked?.product_id ?? parsedKey.productId;

  if (action === 'rm') {
    await sendTelegramMessage({
      chatId,
      text: [
        '🗑 <b>Удалить из отслеживания?</b>',
        '',
        `🛍 ${escapeHtml(truncateTitle(title, 100))}`,
      ].join('\n'),
      inlineKeyboard: [
        [
          { text: '✅ Да, удалить', callback_data: `st:rmok:${ref}` },
          { text: '❌ Отмена', callback_data: `st:rmno:${ref}` },
        ],
      ],
    });
    return { action: 'st_rm_ask' };
  }

  if (action === 'rmno') {
    await sendTelegramMessage({ chatId, text: 'Ок, товар остаётся в списке.' });
    return { action: 'st_rm_cancel' };
  }

  if (action === 'rmok') {
    if (!userId) {
      await sendTelegramMessage({ chatId, text: NOT_LINKED(Number(chatId) || chatId) });
      return { action: 'st_rm_unlink' };
    }
    await upsertTrackedProduct(supabase, {
      userId,
      marketplace: parsedKey.marketplace,
      productId: trackedProductId,
      productTitle: title,
      productUrl: url,
      lastPrice: tracked?.last_price == null ? null : Number(tracked.last_price),
      deleted: true,
    });
    await sendTelegramMessage({
      chatId,
      text: `✅ Удалено: <b>${escapeHtml(truncateTitle(title, 80))}</b>\n\nСписок: «Мои товары» или /status`,
    });
    return { action: 'st_rm_ok' };
  }

  if (action === 'cmp') {
    await sendTyping(chatId);
    const cached = await resolveCachedCompareOffers(supabase, {
      userId,
      marketplace: parsedKey.marketplace,
      productId: parsedKey.productId,
      sourceUrl: url,
      sourcePrice: tracked?.last_price == null ? null : Number(tracked.last_price),
      sourceTitle: title,
    });
    const priced = cached.offers.filter((o) => o.price != null && o.price > 0);
    priced.sort((a, b) => (a.price! - b.price!));
    const best = priced[0];
    await ensureSessionForProduct(supabase, chatId, userId, productKeyStr, title, url);
    await sendTelegramMessage({
      chatId,
      text: renderCachedCompareMessage({
        title,
        offers: cached.offers,
        dataSource: cached.source,
      }),
      inlineKeyboard: compareResultKeyboard({
        bestUrl: best?.url,
        ref,
        alreadyTracked: Boolean(tracked && tracked.deleted === false),
      }),
    });
    return { action: 'st_cmp' };
  }

  // ai | ai_refresh
  await ensureSessionForProduct(supabase, chatId, userId, productKeyStr, title, url);

  if (action === 'ai') {
    const analysis = await loadAnalysisForKey(
      supabase,
      parsedKey.marketplace,
      parsedKey.productId,
    );
    if (analysis) {
      await sendTelegramMessage({
        chatId,
        text: renderFullAnalysis(analysis),
        inlineKeyboard: [
          ...productIntelKeyboard(productKeyStr).slice(0, 3),
          [{ text: '🔄 Обновить анализ', callback_data: `st:ai_refresh:${ref}` }],
        ],
      });
      return { action: 'st_ai_cache' };
    }
    await sendTelegramMessage({
      chatId,
      text: [
        '🤖 <b>AI-анализ</b>',
        '',
        `🛍 ${escapeHtml(truncateTitle(title, 100))}`,
        '',
        'Свежего анализа в кэше нет.',
        'Нажмите «Обновить анализ», чтобы запустить разбор.',
      ].join('\n'),
      inlineKeyboard: [[{ text: '🔄 Обновить анализ', callback_data: `st:ai_refresh:${ref}` }]],
    });
    return { action: 'st_ai_miss' };
  }

  // ai_refresh
  if (!userId) {
    await sendTelegramMessage({ chatId, text: NOT_LINKED(Number(chatId) || chatId) });
    return { action: 'st_ai_refresh_unlink' };
  }
  const premium = await isPremiumUser(supabase, userId);
  const cooldownKey = `${chatId}:${productKeyStr}`;
  const last = aiRefreshAtByKey.get(cooldownKey) ?? 0;
  if (!premium && Date.now() - last < FREE_AI_REFRESH_MS) {
    const hrs = Math.ceil((FREE_AI_REFRESH_MS - (Date.now() - last)) / 3600000);
    await sendTelegramMessage({
      chatId,
      text: `⏳ Free: обновление анализа не чаще раза в 6 ч. Подождите ~${hrs} ч или оформите Premium.`,
    });
    return { action: 'st_ai_refresh_limit' };
  }

  await sendTyping(chatId);
  const linkText = url?.trim() || '';
  const parsedLink = linkText ? parseProductLinkFromText(linkText) : null;
  if (!parsedLink) {
    await sendTelegramMessage({
      chatId,
      text: 'Нет URL товара для обновления. Пришлите ссылку на карточку.',
    });
    return { action: 'st_ai_refresh_no_url' };
  }
  try {
    const card = await runProductIntel({
      supabase,
      parsed: parsedLink,
      chatId,
      userId,
      isPremium: premium,
      allowGenerate: true,
    });
    aiRefreshAtByKey.set(cooldownKey, Date.now());
    if (card.imageUrl) {
      const photo = await sendTelegramPhoto({
        chatId,
        photoUrl: card.imageUrl,
        caption: buildProductIntelCardMessage(card).slice(0, 1024),
        inlineKeyboard: productIntelKeyboard(productKeyStr),
      });
      if (!photo.sent) {
        await sendTelegramMessage({
          chatId,
          text: buildProductIntelCardMessage(card),
          inlineKeyboard: productIntelKeyboard(productKeyStr),
        });
      }
    } else {
      await sendTelegramMessage({
        chatId,
        text: buildProductIntelCardMessage(card),
        inlineKeyboard: productIntelKeyboard(productKeyStr),
      });
    }
    return { action: 'st_ai_refresh_ok' };
  } catch (err) {
    console.error('[telegram-webhook] ai_refresh', err);
    await sendTelegramMessage({
      chatId,
      text: 'Не удалось обновить анализ. Попробуйте прислать ссылку ещё раз.',
    });
    return { action: 'st_ai_refresh_fail' };
  }
}

async function handleCallback(
  supabase: SupabaseClient,
  chatId: string,
  callbackId: string,
  data: string,
): Promise<{ action: string }> {
  await answerTelegramCallback({ callbackQueryId: callbackId });

  if (data.startsWith('faq:')) {
    return handleFaqCallback(supabase, chatId, data);
  }
  if (data.startsWith('st:')) {
    return handleStatusCallback(supabase, chatId, data);
  }

  const m = data.match(/^pi:(\w+):(.+)$/);
  if (!m) {
    await sendTelegramMessage({ chatId, text: 'Неизвестная кнопка.' });
    return { action: 'callback_unknown' };
  }

  const action = m[1]!;
  const ref = m[2]!;
  const productKey = await resolveProductKeyFromCallback(supabase, chatId, ref);
  if (!productKey) {
    await sendTelegramMessage({
      chatId,
      text: 'Сессия товара устарела. Пришлите ссылку ещё раз.',
    });
    return { action: 'callback_no_session' };
  }

  const parsedKey = parseProductKey(productKey);
  if (!parsedKey) {
    await sendTelegramMessage({ chatId, text: 'Некорректный товар в сессии.' });
    return { action: 'callback_bad_key' };
  }

  const session = await getSession(supabase, chatId);
  const analysis = await loadAnalysisForKey(
    supabase,
    parsedKey.marketplace,
    parsedKey.productId,
  );

  if (action === 'full') {
    await sendTelegramMessage({ chatId, text: renderFullAnalysis(analysis) });
    return { action: 'pi_full' };
  }
  if (action === 'buy') {
    await sendTelegramMessage({ chatId, text: renderVerdict(analysis) });
    return { action: 'pi_buy' };
  }
  if (action === 'cons') {
    await sendTelegramMessage({ chatId, text: renderCons(analysis) });
    return { action: 'pi_cons' };
  }
  if (action === 'analogs') {
    await sendTelegramMessage({ chatId, text: renderAnalogs(analysis) });
    return { action: 'pi_analogs' };
  }
  if (action === 'cheap') {
    await sendTyping(chatId);
    const scraper = projectScraperCredentials();
    const sourcePrice =
      session?.product_url
        ? (
            await fetchMarketplacePrice(
              parsedKey.marketplace,
              parsedKey.productId,
              String(session.product_url),
              { supabase, scraper },
            )
          )?.price ?? null
        : null;
    const offers = await lookupCheapOffers(
      supabase,
      parsedKey.marketplace,
      parsedKey.productId,
      sourcePrice,
      scraper,
    );
    await sendTelegramMessage({
      chatId,
      text: renderCheaper(
        String(session?.product_title ?? 'Товар'),
        sourcePrice,
        offers,
      ),
    });
    return { action: 'pi_cheap' };
  }
  if (action === 'hist') {
    const userId = await resolveUserId(supabase, chatId);
    let tracked = false;
    let lastPrice: number | null = null;
    let lastChecked: string | null = null;
    let points: Array<{ price: number; recordedAt: string }> = [];
    let minLine: string | null = null;
    if (userId) {
      const row = await findTrackedRow(
        supabase,
        userId,
        parsedKey.marketplace,
        parsedKey.productId,
      );
      if (row && !row.deleted) {
        tracked = true;
        lastPrice = row.last_price;
        lastChecked = row.last_checked;
      }
      const histProductId = row?.product_id ?? parsedKey.productId;
      points = await loadPriceHistory(supabase, {
        userId,
        marketplace: parsedKey.marketplace,
        productId: histProductId,
        limit: 20,
      });
      const mins = await loadPriceMins(supabase, {
        userId,
        marketplace: parsedKey.marketplace,
        productId: histProductId,
      });
      minLine = formatMinStatusLine(lastPrice, mins);
    }
    await sendTelegramMessage({
      chatId,
      text: [
        renderHistory({
          title: String(session?.product_title ?? 'Товар'),
          lastPrice,
          lastChecked,
          tracked,
          points,
        }),
        minLine ? `\n${escapeHtml(minLine)}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    });
    return { action: 'pi_hist' };
  }
  if (action === 'watch') {
    const userId = await resolveUserId(supabase, chatId);
    if (!userId) {
      await sendTelegramMessage({ chatId, text: NOT_LINKED(chatId) });
      return { action: 'pi_watch_unlink' };
    }
    const url = String(session?.product_url ?? '');
    if (!url) {
      await sendTelegramMessage({
        chatId,
        text: 'Нет URL товара. Пришлите ссылку ещё раз.',
      });
      return { action: 'pi_watch_no_url' };
    }
    const added = await addProductFromLink(supabase, userId, url);
    await sendTelegramMessage({
      chatId,
      text: added.reply,
      buttonUrl: added.buttonUrl,
    });
    return { action: 'pi_watch' };
  }
  if (action === 'ask') {
    await setSessionMode(supabase, chatId, 'ai_chat');
    await sendTelegramMessage({
      chatId,
      text: [
        '❓ <b>Режим вопроса AI</b>',
        '',
        'Спросите о товаре текстом, например:',
        '• Почему такая оценка?',
        '• Стоит покупать сейчас?',
        '• Какие недостатки?',
        '',
        'Сначала отвечу из сохранённого анализа (без GPT).',
        '/cancel — выйти из режима.',
      ].join('\n'),
    });
    return { action: 'pi_ask' };
  }

  await sendTelegramMessage({ chatId, text: 'Кнопка пока не поддерживается.' });
  return { action: 'callback_other' };
}

async function getOrCreateThread(
  supabase: SupabaseClient,
  chatId: string,
  productKey: string,
) {
  const now = Date.now();
  const { data: existingRows, error: listError } = await supabase
    .from('telegram_ai_threads')
    .select('*')
    .eq('chat_id', chatId)
    .eq('product_key', productKey)
    .gt('expires_at', new Date(now).toISOString())
    .order('updated_at', { ascending: false })
    .limit(1);

  if (listError) {
    console.error('[telegram-webhook] thread list', listError.message);
  }
  if (existingRows?.[0]) return existingRows[0];

  const { data, error } = await supabase
    .from('telegram_ai_threads')
    .insert({
      chat_id: chatId,
      product_key: productKey,
      rolling_summary: null,
      turns: [],
      expires_at: new Date(now + 48 * 60 * 60 * 1000).toISOString(),
    })
    .select('*')
    .single();

  if (error) {
    console.error('[telegram-webhook] thread create', error.message);
    return null;
  }
  return data;
}

async function askAiChat(
  supabase: SupabaseClient,
  chatId: string,
  question: string,
): Promise<{ action: string; sent: boolean }> {
  const session = await getSession(supabase, chatId);
  if (!session?.product_key) {
    const r = await sendTelegramMessage({
      chatId,
      text: 'Сначала пришлите ссылку на товар.',
    });
    return { action: 'ai_no_session', sent: r.sent };
  }

  const parsedKey = parseProductKey(String(session.product_key));
  if (!parsedKey) {
    const r = await sendTelegramMessage({ chatId, text: 'Сессия товара повреждена.' });
    return { action: 'ai_bad_key', sent: r.sent };
  }

  const analysis = await loadAnalysisForKey(
    supabase,
    parsedKey.marketplace,
    parsedKey.productId,
  );

  const structured = matchStructuredIntent(question, analysis);
  if (structured) {
    const r = await sendTelegramMessage({ chatId, text: structured });
    return { action: 'ai_structured', sent: r.sent };
  }

  if (!analysis) {
    const r = await sendTelegramMessage({
      chatId,
      text: [
        '📭 Нет сохранённого AI-анализа для контекста.',
        'Сделайте анализ в расширении или пришлите ссылку WB ещё раз.',
      ].join('\n'),
    });
    return { action: 'ai_no_analysis', sent: r.sent };
  }

  await sendTyping(chatId);
  const thread = await getOrCreateThread(supabase, chatId, String(session.product_key));
  const turns = Array.isArray(thread?.turns) ? (thread!.turns as Array<{ q: string; a: string }>) : [];
  const lastTurns = turns.slice(-4);

  const system = [
    'Ты — ассистент PriceGuard AI по одному товару.',
    'Отвечай кратко на русском, опираясь ТОЛЬКО на JSON-контекст анализа.',
    'Не выдумывай цены и отзывы. Если данных нет — скажи об этом.',
  ].join(' ');

  const userContent = [
    `Контекст анализа:\n${buildCompactAnalysisContext(analysis)}`,
    thread?.rolling_summary
      ? `\nКраткое резюме диалога: ${String(thread.rolling_summary).slice(0, 400)}`
      : '',
    lastTurns.length
      ? `\nНедавние реплики:\n${lastTurns.map((t) => `Q: ${t.q}\nA: ${t.a}`).join('\n')}`
      : '',
    `\nВопрос пользователя: ${question}`,
  ]
    .filter(Boolean)
    .join('\n');

  const url = Deno.env.get('SUPABASE_URL');
  const anon = Deno.env.get('SUPABASE_ANON_KEY')?.trim();
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim();
  const key = anon || service;
  if (!url || !key) {
    const r = await sendTelegramMessage({ chatId, text: '⚠️ AI временно недоступен.' });
    return { action: 'ai_misconfig', sent: r.sent };
  }

  try {
    const res = await fetch(`${url}/functions/v1/ai-proxy`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        apikey: key,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        provider: 'grok',
        jsonMode: false,
        temperature: 0.3,
        max_tokens: 500,
        deviceId: `tg:${chatId}`.slice(0, 64),
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userContent },
        ],
      }),
    });
    const body = await res.json().catch(() => ({})) as {
      ok?: boolean;
      text?: string;
      error?: string;
    };
    if (!res.ok || !body.ok || !body.text) {
      const r = await sendTelegramMessage({
        chatId,
        text: `⚠️ Не удалось получить ответ AI.${body.error ? `\n<code>${escapeHtml(body.error)}</code>` : ''}`,
      });
      return { action: 'ai_fail', sent: r.sent };
    }

    const answer = body.text.trim().slice(0, 3500);
    const newTurns = [...lastTurns, { q: question.slice(0, 400), a: answer.slice(0, 800) }].slice(-4);
    if (thread?.id) {
      await supabase
        .from('telegram_ai_threads')
        .update({
          turns: newTurns,
          rolling_summary: `${String(session.product_title ?? '')}: ${answer.slice(0, 200)}`,
          updated_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
        })
        .eq('id', thread.id);
    }

    const r = await sendTelegramMessage({
      chatId,
      text: `🤖 ${escapeHtml(answer)}\n\n⭐ <i>контекст: сохранённый анализ · без полного pipeline</i>`,
    });
    return { action: 'ai_llm', sent: r.sent };
  } catch (e) {
    console.error('[telegram-webhook] ai chat', e);
    const r = await sendTelegramMessage({ chatId, text: '⚠️ Ошибка AI. Попробуйте позже.' });
    return { action: 'ai_error', sent: r.sent };
  }
}

const NOT_LINKED = (chatId: number | string) =>
  [
    '🔗 <b>Сначала привяжите Telegram</b>',
    '',
    'Иначе бот не видит товары из расширения.',
    '',
    '1. PriceGuard AI → «Аккаунт» (вход)',
    '2. Настройки → Telegram → Вкл',
    `3. Chat ID: <code>${chatId}</code>`,
    '4. «Подключить и проверить»',
    '',
    'После привязки откройте «Список» в расширении (синхронизация), затем /status.',
  ].join('\n');

const ADD_PROMPT = [
  '➕ <b>Добавление товара</b>',
  '',
  'Пришлите ссылку на карточку одним сообщением:',
  'WB · Ozon · Яндекс.Маркет',
  '',
  'Или сразу: <code>/add https://…</code>',
  '/cancel — отмена',
].join('\n');

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return jsonResponse({ ok: true });
  }

  if (req.method === 'GET') {
    const token = resolveBotToken();
    if (!token) {
      return jsonResponse({ ok: false, error: 'TELEGRAM_BOT_TOKEN missing' });
    }
    const identity = await getBotIdentity(token);
    return jsonResponse({
      ok: identity.ok,
      expected: 'PriceGuardAlertsBot',
      secretBot: identity,
      match: identity.username === 'PriceGuardAlertsBot',
      commands: ['/start', '/help', '/status', '/add'],
      hiddenCommands: ['/chatid', '/cancel', '/remove'],
      features: [
        'product_intel',
        'reply_keyboard',
        'status_cards',
        'faq',
        'compare_cache',
        'digest_toggle',
      ],
    });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Method not allowed' }, 405);
  }

  const expectedSecret = Deno.env.get('TELEGRAM_WEBHOOK_SECRET')?.trim();
  if (!expectedSecret) {
    console.error('[telegram-webhook] TELEGRAM_WEBHOOK_SECRET is not set');
    return jsonResponse({ ok: false, error: 'misconfigured' }, 503);
  }
  const got = req.headers.get('X-Telegram-Bot-Api-Secret-Token')?.trim();
  if (got !== expectedSecret) {
    return jsonResponse({ ok: false, error: 'Unauthorized' }, 401);
  }

  try {
    const update = (await req.json()) as TelegramUpdate;

    // ——— Callbacks (inline keyboard) ———
    if (update.callback_query?.id && update.callback_query.data) {
      const chatId =
        update.callback_query.message?.chat?.id ??
        update.callback_query.from?.id;
      if (chatId == null) {
        return jsonResponse({ ok: true, ignored: true });
      }
      const supabase = serviceClient();
      if (!supabase) {
        return jsonResponse({ ok: false, error: 'no supabase' }, 500);
      }
      const result = await handleCallback(
        supabase,
        String(chatId),
        update.callback_query.id,
        update.callback_query.data,
      );
      return jsonResponse({ ok: true, ...result });
    }

    const chatId = update.message?.chat?.id;
    const text = (update.message?.text ?? '').trim();

    if (chatId == null || !text) {
      return jsonResponse({ ok: true, ignored: true });
    }

    const chatIdStr = String(chatId);
    let textNorm = text;
    // Reply keyboard → command aliases
    if (textNorm === REPLY_BTN_STATUS) textNorm = '/status';
    else if (textNorm === REPLY_BTN_HELP) textNorm = '/help';
    else if (textNorm === REPLY_BTN_AI) {
      await sendTelegramMessage({
        chatId: chatIdStr,
        text: [
          '✨ <b>AI-анализ</b>',
          '',
          'Пришлите ссылку на товар WB / Ozon / Я.Маркет.',
          'Или откройте «Мои товары» → кнопка «Анализ» у уже отслеживаемого.',
        ].join('\n'),
        replyKeyboard: alertsMainReplyKeyboard(),
      });
      return jsonResponse({ ok: true, action: 'reply_ai_hint', sent: true });
    } else if (textNorm === REPLY_BTN_FAQ) {
      const sb = serviceClient();
      if (!sb) {
        return jsonResponse({ ok: false, error: 'no supabase' }, 500);
      }
      await sendTelegramMessage({
        chatId: chatIdStr,
        text: buildFaqRootMessage(),
        inlineKeyboard: faqRootKeyboard(),
        replyKeyboard: alertsMainReplyKeyboard(),
      });
      return jsonResponse({ ok: true, action: 'reply_faq', sent: true });
    }

    const command = textNorm.split(/\s+/)[0].toLowerCase().replace(/@\w+$/, '');
    const rest = textNorm.slice(textNorm.indexOf(' ') + 1).trim();
    const hasArgs = textNorm.includes(' ') && rest.length > 0 && rest !== textNorm;
    const supabase = serviceClient();

    let reply: string | null = null;
    let buttonUrl: string | undefined;
    let action = command.startsWith('/') ? command : 'text';
    let inlineKeyboard: Parameters<typeof sendTelegramMessage>[0]['inlineKeyboard'];
    let replyKeyboard: Parameters<typeof sendTelegramMessage>[0]['replyKeyboard'];
    let statusHandled = false;

    if (command === '/start') {
      clearPendingAdd(chatIdStr);
      if (supabase) await setSessionMode(supabase, chatIdStr, 'card').catch(() => undefined);
      const linkedUserId = supabase ? await resolveUserId(supabase, chatIdStr) : null;
      if (!linkedUserId) {
        reply = [
          '👋 <b>PriceGuard Alerts</b>',
          '',
          'Чтобы получать алерты и пользоваться «Мои товары»:',
          '1. Установите расширение PriceGuard AI (кнопка ниже)',
          '2. Войдите в расширении',
          '3. Настройки → Telegram → вставьте Chat ID ниже',
          '4. «Подключить и проверить»',
          '',
          `Chat ID: <code>${chatId}</code>`,
          '',
          'Пока не привязано — можно открыть FAQ.',
        ].join('\n');
        replyKeyboard = alertsMainReplyKeyboard();
        inlineKeyboard = [
          [{ text: '⬇️ Установить расширение', url: CHROME_WEB_STORE_URL }],
          [{ text: '❓ FAQ', callback_data: 'faq:root' }],
          [{ text: '💬 Поддержка', url: 'https://t.me/priceguard_supportbot' }],
        ];
      } else {
        reply = buildStartWelcomeMessage(chatId);
        replyKeyboard = alertsMainReplyKeyboard();
        inlineKeyboard = [
          [{ text: '⬇️ Установить расширение', url: CHROME_WEB_STORE_URL }],
        ];
      }
    } else if (command === '/help') {
      reply = buildHelpMessage();
      replyKeyboard = alertsMainReplyKeyboard();
      inlineKeyboard = [
        [{ text: '⬇️ Установить расширение', url: CHROME_WEB_STORE_URL }],
        [{ text: '❓ FAQ', callback_data: 'faq:root' }],
        [{ text: '💬 Поддержка', url: 'https://t.me/priceguard_supportbot' }],
      ];
    } else if (command === '/chatid') {
      reply = [
        '🪪 <b>Ваш Chat ID</b>',
        '',
        `<code>${chatId}</code>`,
        '',
        'Вставьте в PriceGuard AI → Настройки → Telegram.',
      ].join('\n');
    } else if (command === '/cancel') {
      clearPendingAdd(chatIdStr);
      if (supabase) await setSessionMode(supabase, chatIdStr, 'card').catch(() => undefined);
      reply = '❌ Отменено. Режим обычный.';
      replyKeyboard = alertsMainReplyKeyboard();
    } else if (command === '/status') {
      if (!supabase) {
        reply = '⚠️ Сервер временно недоступен.';
      } else {
        const userId = await resolveUserId(supabase, chatIdStr);
        if (!userId) {
          reply = NOT_LINKED(chatId);
          replyKeyboard = alertsMainReplyKeyboard();
        } else {
          const premium = await isPremiumUser(supabase, userId);
          await sendStatusCards(supabase, chatIdStr, userId, premium);
          statusHandled = true;
          action = '/status';
        }
      }
    } else if (command === '/remove') {
      if (!supabase) {
        reply = '⚠️ Сервер временно недоступен.';
      } else {
        const userId = await resolveUserId(supabase, chatIdStr);
        if (!userId) {
          reply = NOT_LINKED(chatId);
        } else if (hasArgs) {
          const removed = await removeProductFromLink(supabase, userId, rest);
          reply = removed.reply;
          action = 'remove_product';
        } else {
          reply = [
            '🗑 <b>Убрать из отслеживания</b>',
            '',
            'Пришлите: <code>/remove https://…</code>',
            'Или удалите в расширении → «Мои товары» → «Обновить».',
          ].join('\n');
        }
      }
    } else if (command === '/add') {
      if (!supabase) {
        reply = '⚠️ Сервер временно недоступен.';
      } else {
        const userId = await resolveUserId(supabase, chatIdStr);
        if (!userId) {
          reply = NOT_LINKED(chatId);
        } else if (hasArgs) {
          clearPendingAdd(chatIdStr);
          const added = await addProductFromLink(supabase, userId, rest);
          reply = added.reply;
          buttonUrl = added.buttonUrl;
          action = 'add_product';
        } else {
          setPendingAdd(chatIdStr);
          reply = ADD_PROMPT;
        }
      }
    } else if (textNorm.startsWith('/')) {
      reply =
        'Неизвестная команда.\n/start · /status · /add · /help';
    } else if (takePendingAdd(chatIdStr)) {
      action = 'add_product';
      if (!supabase) {
        reply = '⚠️ Сервер временно недоступен.';
      } else {
        const userId = await resolveUserId(supabase, chatIdStr);
        if (!userId) {
          reply = NOT_LINKED(chatId);
        } else {
          const added = await addProductFromLink(supabase, userId, textNorm);
          reply = added.reply;
          buttonUrl = added.buttonUrl;
        }
      }
    } else if (supabase && parseProductLinkFromText(textNorm)) {
      // Product intel pipeline (E1–E7)
      const result = await handleProductLink(supabase, chatIdStr, textNorm);
      return jsonResponse({ ok: true, ...result });
    } else if (supabase) {
      const session = await getSession(supabase, chatIdStr);
      if (session?.mode === 'ai_chat') {
        const result = await askAiChat(supabase, chatIdStr, textNorm);
        return jsonResponse({ ok: true, ...result });
      }

      const faq = matchFaqReply(textNorm);
      if (faq) {
        action = 'faq';
        reply = faq;
      } else {
        // Structured intent on current session without ai_chat mode
        if (session?.product_key) {
          const pk = parseProductKey(String(session.product_key));
          if (pk) {
            const analysis = await loadAnalysisForKey(supabase, pk.marketplace, pk.productId);
            const structured = matchStructuredIntent(textNorm, analysis);
            if (structured) {
              reply = structured;
              action = 'structured_intent';
            }
          }
        }
        if (!reply) {
          reply = [
            '👋 Пришлите <b>ссылку на товар</b> (WB / Ozon / YM) — или кнопки внизу.',
            '',
            '📦 Мои товары · ❓ FAQ · ℹ️ Помощь',
            '',
            `Chat ID: <code>${chatId}</code>`,
          ].join('\n');
          replyKeyboard = alertsMainReplyKeyboard();
        }
      }
    } else {
      reply = '⚠️ Сервер временно недоступен.';
    }

    if (statusHandled) {
      return jsonResponse({ ok: true, action, sent: true });
    }

    if (reply == null) {
      return jsonResponse({ ok: true, ignored: true });
    }

    const result = await sendTelegramMessage({
      chatId: chatIdStr,
      text: reply,
      buttonUrl,
      buttonText: buttonUrl ? '🛒 Открыть товар' : undefined,
      inlineKeyboard,
      replyKeyboard,
    });

    if (!result.sent) {
      console.error('[telegram-webhook] send failed', result.error);
    }

    return jsonResponse({
      ok: true,
      action,
      sent: result.sent,
      error: result.error ?? null,
    });
  } catch (error) {
    console.error('[telegram-webhook]', error);
    return jsonResponse({
      ok: false,
      error: error instanceof Error ? error.message : 'Server error',
    }, 500);
  }
});
