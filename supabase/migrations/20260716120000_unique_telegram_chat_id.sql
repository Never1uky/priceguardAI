-- Один Telegram chat_id может быть привязан только к одному аккаунту
-- (пустые chat_id допускаются у многих пользователей).

-- Сначала очистить дубликаты: оставить самую свежую строку на chat_id
with ranked as (
  select
    user_id,
    telegram_chat_id,
    row_number() over (
      partition by telegram_chat_id
      order by updated_at desc nulls last
    ) as rn
  from public.user_alert_settings
  where telegram_chat_id is not null
    and length(trim(telegram_chat_id)) > 0
)
update public.user_alert_settings u
set
  telegram_chat_id = '',
  telegram_enabled = false,
  server_monitoring = false,
  updated_at = now()
from ranked r
where u.user_id = r.user_id
  and r.rn > 1;

create unique index if not exists user_alert_settings_telegram_chat_unique
  on public.user_alert_settings (telegram_chat_id)
  where telegram_chat_id is not null
    and length(trim(telegram_chat_id)) > 0;
