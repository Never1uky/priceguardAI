-- Opt-in morning digest for @PriceGuardAlertsBot (daily-user-digest cron)

alter table public.user_alert_settings
  add column if not exists digest_enabled boolean not null default false;

alter table public.user_alert_settings
  add column if not exists digest_hour smallint not null default 9;

comment on column public.user_alert_settings.digest_enabled is
  'If true, daily-user-digest cron sends one morning summary to telegram_chat_id';

comment on column public.user_alert_settings.digest_hour is
  'Preferred local hour (Europe/Moscow) for digest; MVP cron runs ~09:00 MSK';

alter table public.user_alert_settings
  drop constraint if exists user_alert_settings_digest_hour_check;

alter table public.user_alert_settings
  add constraint user_alert_settings_digest_hour_check
  check (digest_hour >= 0 and digest_hour <= 23);
