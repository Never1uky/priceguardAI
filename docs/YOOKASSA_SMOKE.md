# ЮKassa smoke — перед CWS Unlisted

Один полный happy-path на **тестовом** магазине ЮKassa. Не использовать боевые карты для этого чеклиста.

Связано: `docs/RELEASE_GO.md`, `docs/SUPABASE.md` § webhook.

## Предварительно

1. Supabase Secrets: `YOOKASSA_SHOP_ID`, `YOOKASSA_SECRET_KEY` (тестовый магазин).
2. Webhook URL в кабинете ЮKassa:  
   `https://ihlfvpocwobvcpxbypsd.supabase.co/functions/v1/yookassa-webhook`  
   События: `payment.succeeded`, `payment.canceled`.
3. Edge задеплоены: `create-payment`, `yookassa-webhook`, `check-payment`, `validate-license`.
4. Расширение: свежий zip (`priceguard-ai-v0.9.70.zip` или новее), Load unpacked / обновить.

## Шаги

| # | Действие | Ожидание | ✓ |
|---|----------|----------|---|
| 1 | Popup → **Аккаунт** → войти | Сессия есть |
| 2 | **Premium** → план (monthly) → **Оплатить** | Редирект на ЮKassa; без входа — ошибка AUTH |
| 3 | Тестовая карта успеха: `5555555555554444`, срок любой будущий, CVC `123` | Платёж succeeded |
| 4 | Вернуться в расширение → **Проверить оплату** (если нужно) | Ключ `PGAI-…` / Premium on |
| 5 | Supabase → `payments` | `status = succeeded`, есть `yookassa_payment_id` |
| 6 | Supabase → `license_keys` + activations | Ключ привязан к `user_id` |
| 7 | Edge logs `yookassa-webhook` | Нет amount mismatch / payment id mismatch |
| 8 | (опц.) AI / лимиты Premium | Freemium-блок снят |

## Отказ (негативный, опционально)

| # | Действие | Ожидание |
|---|----------|----------|
| N1 | Карта отказа `5555555555554477` | Платеж canceled; Premium не выдан |

## Не путать

- Старые demo keys (`PGAI-DEMO-…`) **не** заменяют этот smoke.
- В клиенте нет офлайн-демо: только оплата → webhook → `validate-license`.

## После успеха

Отметить в `docs/RELEASE_GO.md` пункт «ЮKassa smoke» и грузить **Unlisted** в CWS.
