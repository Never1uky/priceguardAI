# @PriceGuardAlertsBot — алерты, product intel, /start webhook
#
# Деплой:
#   npx supabase db push
#   npx supabase functions deploy telegram-webhook product-intel reviews-fetch
#
# Миграция сессий: 20260717180000_telegram_product_sessions.sql
#
# Привязать webhook (PowerShell, подставьте TOKEN):
#
#   $TOKEN = "123:ABC"
#   $URL = "https://ihlfvpocwobvcpxbypsd.supabase.co/functions/v1/telegram-webhook"
#   curl.exe "https://api.telegram.org/bot$TOKEN/setWebhook" `
#     -d "url=$URL" `
#     -d "allowed_updates=[`"message`",`"callback_query`"]"
#
# Важно: allowed_updates должен включать callback_query (inline-кнопки).
#
# Проверка:
#   curl.exe "https://api.telegram.org/bot$TOKEN/getWebhookInfo"
#
# BotFather /setcommands для @PriceGuardAlertsBot:
# start - Приветствие и Chat ID
# status - Отслеживаемые товары и цены
# add - Добавить товар в отслеживание
# help - Справка
# chatid - Показать Chat ID
# cancel - Отмена / выход из AI-чата
#
# Ссылка на товар (без /add) → карточка AI + кнопки
# /add — только трекинг цены
#
# Ошибки расширения → support-notify → TELEGRAM_SUPPORT_CHAT_ID или TELEGRAM_CHAT_ID
#   npx supabase secrets set TELEGRAM_SUPPORT_CHAT_ID=ваш_admin_chat_id
#
# Бот поддержки @priceguard_supportbot (меню + автоответы):
#   supabase/scripts/setup-support-bot.md
#   npx supabase functions deploy support-webhook
