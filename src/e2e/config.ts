/**
 * Конфигурация E2E-тестов PriceGuard AI.
 *
 * Режимы (переменные окружения):
 *   E2E_LIVE=1       — тесты на реальных API/страницах маркетплейсов (мягкий skip при блокировке)
 *   E2E_AI_LIVE=1    — дополнительно: живой AI через Supabase ai-proxy (нужен .env с VITE_SUPABASE_*)
 *
 * По умолчанию (`npm run test`) — только офлайн-фикстуры, без сети.
 *
 * @example PowerShell — live
 *   $env:E2E_LIVE=1; npm run test:e2e
 * @example PowerShell — live + AI
 *   $env:E2E_LIVE=1; $env:E2E_AI_LIVE=1; npm run test:e2e
 */

/** Запуск на живых страницах/API маркетплейсов */
export const E2E_LIVE = process.env.E2E_LIVE === '1';

/** Дополнительно: реальный запрос к ai-proxy (тратит токены) */
export const E2E_AI_LIVE = process.env.E2E_AI_LIVE === '1';

/** WB dest для API (Москва) */
export const WB_DEST = '-1257786';

/** Тестовые товары для live-режима */
export const LIVE_PRODUCTS = {
  wildberries: {
    nmId: '292619464',
    title: 'Apple AirPods Max',
    searchQuery: 'Apple AirPods Max',
    minPrice: 30_000,
    maxPrice: 120_000,
  },
  ozon: {
    productId: '123456789',
    url: 'https://www.ozon.ru/product/apple-airpods-pro-2-123456789/',
    title: 'Apple AirPods Pro 2',
    searchQuery: 'Apple AirPods Pro 2',
    minPrice: 15_000,
    maxPrice: 80_000,
  },
  yandex_market: {
    productId: '987654321',
    url: 'https://market.yandex.ru/product/987654321',
    title: 'Apple AirPods Pro 2',
    searchQuery: 'Apple AirPods Pro 2',
    minPrice: 15_000,
    maxPrice: 80_000,
  },
} as const;

/** Таймаут live-тестов (мс) */
export const LIVE_TEST_TIMEOUT_MS = 45_000;
