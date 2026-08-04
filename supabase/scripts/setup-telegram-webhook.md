# @PriceGuardAlertsBot — алерты, product intel, Reply Keyboard, FAQ, status cards
#
# Деплой:
#   npx supabase db push
#   npx supabase functions deploy telegram-webhook daily-user-digest
#
# Миграции:
#   20260717180000_telegram_product_sessions.sql
#   20260723215943_digest_enabled.sql
#
# Привязать webhook (PowerShell, подставьте TOKEN и SECRET):
#
#   $TOKEN = "123:ABC"
#   $SECRET = "your-TELEGRAM_WEBHOOK_SECRET"
#   $URL = "https://ihlfvpocwobvcpxbypsd.supabase.co/functions/v1/telegram-webhook"
#   curl.exe "https://api.telegram.org/bot$TOKEN/setWebhook" `
#     -d "url=$URL" `
#     -d "secret_token=$SECRET" `
#     -d "allowed_updates=[`"message`",`"callback_query`"]"
#
# Важно: allowed_updates должен включать callback_query (inline-кнопки).
# Secret должен совпадать с TELEGRAM_WEBHOOK_SECRET в Edge secrets.
#
# Проверка:
#   curl.exe "https://api.telegram.org/bot$TOKEN/getWebhookInfo"
#
# BotFather /setcommands для @PriceGuardAlertsBot (только публичные):
# start - Приветствие и меню
# help - Справка
# status - Мои товары
# add - Добавить товар по ссылке
#
# Скрытые (работают, но не в меню BotFather):
#   /chatid — показать Chat ID
#   /cancel — выход из AI-чата / отмена /add
#   /remove — fallback удаления по ссылке (UX: кнопка «Удалить» в «Мои товары»)
#
# Reply Keyboard: Мои товары · AI-анализ · FAQ · Помощь
# /status — до 5 карточек с кнопками Анализ / Сравнение / Удалить
# Сравнение в боте — только кэш (compare_products / mapping), без scrape
# Дайджест: FAQ → «Дайджест» → вкл/выкл; cron: scripts/setup-daily-digest-cron.sql
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
