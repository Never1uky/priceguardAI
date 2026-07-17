// Webhook @PriceGuardAlertsBot
// Команды: /start /help /chatid /status /add
// Ссылка на товар → product-intel карточка + inline keyboard
// Secrets: TELEGRAM_BOT_TOKEN, SUPABASE_SERVICE_ROLE_KEY

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { jsonResponse } from '../_shared/utils.ts';
import { fetchMarketplacePrice } from '../_shared/marketplace-prices.ts';
import { parseProductLinkFromText } from '../_shared/product-url.ts';
import { upsertTrackedProduct } from '../_shared/tracked-upsert.ts';
import { parseProductKey } from '../_shared/product-id.ts';
import { runProductIntel, loadAnalysisForKey, lookupCheapOffers } from '../_shared/product-intel.ts';
import { loadPriceHistory } from '../_shared/price-history.ts';
import {
  buildProductIntelCardMessage,
  productIntelKeyboard,
  expandShortRef,
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
  escapeHtml,
  matchFaqReply,
  sendTelegramMessage,
  sendTelegramPhoto,
  answerTelegramCallback,
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

async function loadTrackedForUser(supabase: SupabaseClient, userId: string) {
  const { data: rows, error } = await supabase
    .from('tracked_products')
    .select('product_title, marketplace, last_price, target_price, last_checked, last_fetch_error')
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
    marketplace: r.marketplace as string | null,
    lastPrice: r.last_price == null ? null : Number(r.last_price),
    targetPrice: r.target_price == null ? null : Number(r.target_price),
    lastChecked: (r.last_checked as string | null) ?? null,
    lastFetchError: (r.last_fetch_error as string | null) ?? null,
  }));
}

async function isPremiumUser(supabase: SupabaseClient, userId: string): Promise<boolean> {
  const { data } = await supabase
    .from('user_premium')
    .select('expires_at')
    .eq('user_id', userId)
    .maybeSingle();
  if (!data) return false;
  return !data.expires_at || new Date(data.expires_at) > new Date();
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
  if (!premium) {
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

      if ((count ?? 0) >= FREE_TRACK_LIMIT) {
        return {
          ok: false,
          reply: [
            `📦 Лимит Free: до <b>${FREE_TRACK_LIMIT}</b> товаров.`,
            '',
            'Удалите товар в расширении → «Список» или оформите Premium.',
          ].join('\n'),
          buttonUrl: parsed.url,
        };
      }
    }
  }

  const fetched = await fetchMarketplacePrice(
    parsed.marketplace,
    parsed.productId,
    parsed.url,
    { supabase },
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
    }),
    buttonUrl: url,
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
  if (fromRef) {
    const session = await getSession(supabase, chatId);
    if (session?.product_key === fromRef) return fromRef;
    // ref может совпасть с текущей сессией даже если session другая — доверяем session
    if (session?.product_key) return String(session.product_key);
    return fromRef;
  }
  const session = await getSession(supabase, chatId);
  return session?.product_key ? String(session.product_key) : null;
}

async function handleCallback(
  supabase: SupabaseClient,
  chatId: string,
  callbackId: string,
  data: string,
): Promise<{ action: string }> {
  await answerTelegramCallback({ callbackQueryId: callbackId });

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
    const sourcePrice =
      session?.product_url
        ? (
            await fetchMarketplacePrice(
              parsedKey.marketplace,
              parsedKey.productId,
              String(session.product_url),
              { supabase },
            )
          )?.price ?? null
        : null;
    const offers = await lookupCheapOffers(
      supabase,
      parsedKey.marketplace,
      parsedKey.productId,
      sourcePrice,
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
    if (userId) {
      const { data } = await supabase
        .from('tracked_products')
        .select('last_price, last_checked')
        .eq('user_id', userId)
        .eq('marketplace', parsedKey.marketplace)
        .eq('product_id', parsedKey.productId)
        .eq('deleted', false)
        .maybeSingle();
      if (data) {
        tracked = true;
        lastPrice = data.last_price == null ? null : Number(data.last_price);
        lastChecked = (data.last_checked as string | null) ?? null;
      }
      points = await loadPriceHistory(supabase, {
        userId,
        marketplace: parsedKey.marketplace,
        productId: parsedKey.productId,
        limit: 20,
      });
    }
    await sendTelegramMessage({
      chatId,
      text: renderHistory({
        title: String(session?.product_title ?? 'Товар'),
        lastPrice,
        lastChecked,
        tracked,
        points,
      }),
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
      commands: ['/start', '/status', '/add', '/help', '/chatid'],
      features: ['product_intel', 'inline_keyboard', 'ai_chat', 'faq', 'add_command'],
    });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Method not allowed' }, 405);
  }

  const expectedSecret = Deno.env.get('TELEGRAM_WEBHOOK_SECRET')?.trim();
  if (expectedSecret) {
    const got = req.headers.get('X-Telegram-Bot-Api-Secret-Token')?.trim();
    if (got !== expectedSecret) {
      return jsonResponse({ ok: false, error: 'Unauthorized' }, 401);
    }
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
    const command = text.split(/\s+/)[0].toLowerCase().replace(/@\w+$/, '');
    const rest = text.slice(text.indexOf(' ') + 1).trim();
    const hasArgs = text.includes(' ') && rest.length > 0 && rest !== text;
    const supabase = serviceClient();

    let reply: string | null = null;
    let buttonUrl: string | undefined;
    let action = command.startsWith('/') ? command : 'text';
    let inlineKeyboard: Parameters<typeof sendTelegramMessage>[0]['inlineKeyboard'];

    if (command === '/start') {
      clearPendingAdd(chatIdStr);
      if (supabase) await setSessionMode(supabase, chatIdStr, 'card').catch(() => undefined);
      reply = [
        buildStartWelcomeMessage(chatId),
        '',
        '🔗 Пришлите ссылку на товар — сделаю карточку с AI (из кэша или WB).',
      ].join('\n');
    } else if (command === '/help') {
      reply = [
        buildHelpMessage(),
        '',
        '🔗 Ссылка на WB/Ozon/YM → анализ + кнопки.',
      ].join('\n');
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
    } else if (command === '/status') {
      if (!supabase) {
        reply = '⚠️ Сервер временно недоступен.';
      } else {
        const userId = await resolveUserId(supabase, chatIdStr);
        if (!userId) {
          reply = NOT_LINKED(chatId);
        } else {
          const items = await loadTrackedForUser(supabase, userId);
          reply = buildStatusMessage(items);
          if (items.length === 0) {
            reply += [
              '',
              '',
              'Если товары есть в расширении, но здесь пусто:',
              '• откройте «Список» в popup (синхронизация)',
              '• убедитесь, что «Подключить и проверить» сделано после входа',
              '• добавить вручную: /add',
            ].join('\n');
          }
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
    } else if (text.startsWith('/')) {
      reply =
        'Неизвестная команда.\n/start · /status · /add · /help · /chatid';
    } else if (takePendingAdd(chatIdStr)) {
      action = 'add_product';
      if (!supabase) {
        reply = '⚠️ Сервер временно недоступен.';
      } else {
        const userId = await resolveUserId(supabase, chatIdStr);
        if (!userId) {
          reply = NOT_LINKED(chatId);
        } else {
          const added = await addProductFromLink(supabase, userId, text);
          reply = added.reply;
          buttonUrl = added.buttonUrl;
        }
      }
    } else if (supabase && parseProductLinkFromText(text)) {
      // Product intel pipeline (E1–E7)
      const result = await handleProductLink(supabase, chatIdStr, text);
      return jsonResponse({ ok: true, ...result });
    } else if (supabase) {
      const session = await getSession(supabase, chatIdStr);
      if (session?.mode === 'ai_chat') {
        const result = await askAiChat(supabase, chatIdStr, text);
        return jsonResponse({ ok: true, ...result });
      }

      const faq = matchFaqReply(text);
      if (faq) {
        action = 'faq';
        reply = faq;
      } else {
        // Structured intent on current session without ai_chat mode
        if (session?.product_key) {
          const pk = parseProductKey(String(session.product_key));
          if (pk) {
            const analysis = await loadAnalysisForKey(supabase, pk.marketplace, pk.productId);
            const structured = matchStructuredIntent(text, analysis);
            if (structured) {
              reply = structured;
              action = 'structured_intent';
            }
          }
        }
        if (!reply) {
          reply = [
            '👋 Пришлите <b>ссылку на товар</b> (WB / Ozon / YM) — сделаю карточку с AI.',
            '',
            'Команды: /status · /add · /help · /chatid',
            '',
            `Chat ID: <code>${chatId}</code>`,
          ].join('\n');
        }
      }
    } else {
      reply = '⚠️ Сервер временно недоступен.';
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
