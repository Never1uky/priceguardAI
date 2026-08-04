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
$SECRET = "ваш-TELEGRAM_SUPPORT_WEBHOOK_SECRET"
$URL = "https://ihlfvpocwobvcpxbypsd.supabase.co/functions/v1/support-webhook"
curl.exe "https://api.telegram.org/bot$TOKEN/setWebhook" `
  -d "url=$URL" `
  -d "secret_token=$SECRET" `
  -d "allowed_updates=[`"message`",`"callback_query`"]"
```

Проверка:

```bash
curl.exe "https://ihlfvpocwobvcpxbypsd.supabase.co/functions/v1/support-webhook"
# ожидается: "expected":"priceguard_supportbot", "match":true
```

## BotFather → /setcommands для @priceguard_supportbot

Публичные команды (без `/status` — список товаров только в alerts-боте):

```
start - Главное меню поддержки
help - Справка
premium - Тарифы Premium
mykey - Лицензионный ключ
feedback - Отзыв или предложение
```

`/status` можно оставить в коде как soft-redirect на @PriceGuardAlertsBot, но **не** добавлять в BotFather.

## Команды и inline-кнопки

| Команда / кнопка | Действие |
|------------------|----------|
| `/start` + меню | Приветствие + inline |
| 👑 Подписка Premium | Цены 299 ₽/мес · 2490 ₽/год |
| 🛠 Сообщить о проблеме | Ждёт текст → пересылает вам |
| ⭐ Отзыв | Ждёт текст → пересылает вам |
| ℹ️ Справка | `/help` |
| 📉 Бот алертов | Deep-link @PriceGuardAlertsBot |
| `/premium` | То же, что кнопка Premium |
| `/feedback` | Режим отзыва |
| `/mykey` | Ключ лицензии (если привязан Chat ID) |
| `/status` | Redirect: товары → @PriceGuardAlertsBot |
| `/cancel` | Отмена режима отзыва |

Тексты без FAQ автоматически уходят в `TELEGRAM_SUPPORT_CHAT_ID`.

FAQ (автоответы в коде `support-bot.ts`): Premium, Telegram-алерты, troubleshooting, **пустой поиск / VPN / adblock**, отзывы.

## Как отвечать на обращения (админ)

В форварде есть `chat: <id>` и подсказка.

1. **Reply** на сообщение «Обращение в поддержку» — текст ответа уйдёт пользователю.
2. Или команда: `/reply 487547625 ваш текст ответа`

Обычные команды (`/mykey`, `/premium` …) работают и из админ-чата — админ-режим включается только для `/reply` и Reply на обращение.

Пользователь увидит: «Ответ поддержки: …».

После изменений кода:

```bash
npx supabase functions deploy support-webhook --project-ref ihlfvpocwobvcpxbypsd
```
