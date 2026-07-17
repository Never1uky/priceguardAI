/**
 * Блокировка параллельных тяжёлых AI-задач (полный анализ).
 * chrome.storage.session — общий флаг для popup и service worker.
 */

const BUSY_KEY = 'priceguard_full_analysis_busy';

export async function setFullAnalysisBusy(busy: boolean): Promise<void> {
  await chrome.storage.session.set({ [BUSY_KEY]: busy });
}

export async function isFullAnalysisBusy(): Promise<boolean> {
  const stored = await chrome.storage.session.get(BUSY_KEY);
  return Boolean(stored[BUSY_KEY]);
}

export const FULL_ANALYSIS_BUSY_MESSAGE =
  'Дождитесь завершения полного AI-анализа — затем можно перейти на другую вкладку.';
