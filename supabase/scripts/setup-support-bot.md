# @priceguard_supportbot — меню поддержки и автоответы

## Secrets

```bash
npx supabase secrets set TELEGRAM_SUPPORT_BOT_TOKEN=токен_от_BotFather
npx supabase secrets set TELEGRAM_SUPPORT_CHAT_ID=ваш_telegram_user_id
```

`TELEGRAM_SUPPORT_CHAT_ID` — куда слать отзывы / проблемы / сообщения без FAQ  
(обычно ваш личный chat id; узнать у @userinfobot или через /start у любого бота).

Не путать с `TELEGRAM_BOT_TOKEN` (@PriceGuardAlertsBot).

## Deploy + webhook

```bash
npx supabase functions deploy support-webhook --project-ref ihlfvpocwobvcpxbypsd

$TOKEN = "ТОКЕН_priceguard_supportbot"
$URL = "https://ihlfvpocwobvcpxbypsd.supabase.co/functions/v1/support-webhook"
curl.exe "https://api.telegram.org/bot$TOKEN/setWebhook" `
  -d "url=$URL" `
  -d "allowed_updates=[`"message`",`"callback_query`"]"
```

Проверка:

```bash
curl.exe "https://ihlfvpocwobvcpxbypsd.supabase.co/functions/v1/support-webhook"
# ожидается: "expected":"priceguard_supportbot", "match":true
```

## BotFather → /setcommands для @priceguard_supportbot

Сейчас в меню только `start` / `help`. **Замените** на:

```
start - Главное меню поддержки
help - Справка
status - Мои отслеживаемые товары
premium - Тарифы Premium
feedback - Отзыв или предложение
```

**Убрать** (если были): chatid и любые команды алертов — они у @PriceGuardAlertsBot.

## Команды и inline-кнопки

| Команда / кнопка | Действие |
|------------------|----------|
| `/start` + меню | Приветствие + inline |
| 👑 Подписка Premium | Цены 299 ₽/мес · 2490 ₽/год |
| 🛠 Сообщить о проблеме | Ждёт текст → пересылает вам |
| ⭐ Отзыв | Ждёт текст → пересылает вам |
| 📋 Мои товары | `/status` (нужна привязка Chat ID в расширении) |
| ℹ️ Справка | `/help` |
| `/premium` | То же, что кнопка Premium |
| `/feedback` | Режим отзыва |
| `/cancel` | Отмена режима отзыва |

Тексты без FAQ автоматически уходят в `TELEGRAM_SUPPORT_CHAT_ID`.

## Как отвечать на обращения (админ)

В форварде есть `chat: <id>` и подсказка.

1. **Reply** на сообщение «Обращение в поддержку» — текст ответа уйдёт пользователю.
2. Или команда: `/reply 487547625 ваш текст ответа`

Обычные команды (`/mykey`, `/status`, `/premium` …) работают и из админ-чата — админ-режим включается только для `/reply` и Reply на обращение.

Пользователь увидит: «Ответ поддержки: …».

После изменений кода:

```bash
npx supabase functions deploy support-webhook --project-ref ihlfvpocwobvcpxbypsd
```

(при смене FAQ алертов — ещё `telegram-webhook`).
