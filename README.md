# PriceGuard AI

Chrome-расширение (Manifest V3) + Telegram-боты для покупок на **Wildberries**, **Ozon** и **Яндекс.Маркет**.

**Текущая версия:** 0.9.90 (Early access)

## Что умеет

- **AI-анализ отзывов** и полный разбор товара (плюс/минус, риск накрутки, вердикт)
- **Сравнение цен** между тремя площадками («где дешевле»)
- **Отслеживание** с историей цен и целевой ценой
- **Алерты** в браузере и в **@PriceGuardAlertsBot** (в т.ч. без открытого Chrome)
- **AI по ссылке** в Telegram: пришлите URL → карточка, кнопки, вопросы AI
- Поддержка: **@priceguard_supportbot**

Free: до 5 отслеживаемых, до **3** AI-анализов/сутки (после входа).  
Premium: без лимита AI, до **50** товаров, приоритет серверной проверки.

## Стек

- React 19 + TypeScript, Vite + [@crxjs/vite-plugin](https://crxjs.dev/vite-plugin)
- Tailwind CSS + shadcn/ui
- Supabase (Auth, Postgres, Edge Functions)
- Telegram Bot API

## Быстрый старт

```bash
cd priceguard-ai
npm install
npm run dev
```

1. `chrome://extensions` → Режим разработчика  
2. «Загрузить распакованное» → папка `dist`

## Сборка и zip для Chrome

```bash
npm run package:zip
```

Артефакт: `priceguard-ai-v{version}.zip` в корне проекта (сейчас `priceguard-ai-v0.9.90.zip`).

## Документация

| Документ | Путь |
|----------|------|
| Политика конфиденциальности (RU/EN) | [docs/PRIVACY_POLICY_RU.md](docs/PRIVACY_POLICY_RU.md), [EN](docs/PRIVACY_POLICY_EN.md) |
| HTML Privacy | [docs/privacy/](docs/privacy/) · сайт: https://priceguard-landing.vercel.app/privacy |
| Chrome Web Store | [docs/CHROME_WEB_STORE_LISTING.md](docs/CHROME_WEB_STORE_LISTING.md) |
| Changelog | [CHANGELOG.md](CHANGELOG.md) |
| Supabase / мониторинг | [docs/SUPABASE.md](docs/SUPABASE.md) |
| QA | [docs/QA_DEBUG_CHECKLIST.md](docs/QA_DEBUG_CHECKLIST.md) |

## Поддерживаемые URL

- `https://www.wildberries.ru/catalog/*/detail.aspx`
- `https://www.ozon.ru/product/*`
- `https://market.yandex.ru/...` (карточки товаров)

## Контакты

- Email: priceguardAlsupp0rt@yandex.ru  
- Telegram: @priceguard_supportbot  
- Лендинг: https://priceguard-landing.vercel.app
