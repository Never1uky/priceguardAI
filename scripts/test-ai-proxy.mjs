// Простой тест Edge Function `ai-proxy` из терминала.
//
// Читает VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY из .env (или из окружения),
// отправляет тестовый запрос на ai-proxy и печатает ответ.
//
// Запуск (PowerShell):
//   node scripts/test-ai-proxy.mjs
//   node scripts/test-ai-proxy.mjs openai "Скажи привет по-русски"
//
// Аргументы (опционально):
//   1) provider: grok | openai   (по умолчанию grok)
//   2) prompt:   текст запроса    (по умолчанию "Reply with exactly one word: OK")

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Мини-парсер .env (без зависимостей). Существующие переменные окружения имеют приоритет. */
function loadEnv() {
  const env = { ...process.env };
  try {
    const raw = readFileSync(join(root, '.env'), 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (env[key] === undefined) env[key] = value;
    }
  } catch {
    // .env может отсутствовать — тогда полагаемся на process.env
  }
  return env;
}

async function main() {
  const env = loadEnv();
  const url = (env.VITE_SUPABASE_URL ?? '').trim();
  const anonKey =
    (env.VITE_SUPABASE_ANON_KEY ?? env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '').trim();

  if (!url || !anonKey) {
    console.error('[ai-proxy test] Нет VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (проверьте .env)');
    process.exitCode = 1;
    return;
  }

  const provider = process.argv[2] === 'openai' ? 'openai' : 'grok';
  const prompt = process.argv[3] ?? 'Reply with exactly one word: OK';

  const endpoint = `${url.replace(/\/$/, '')}/functions/v1/ai-proxy`;
  const body = {
    provider,
    messages: [
      { role: 'system', content: 'You are a connection test assistant.' },
      { role: 'user', content: prompt },
    ],
    temperature: 0.2,
    max_tokens: 64,
    jsonMode: false,
    deviceId: 'ai-proxy-test-script',
  };

  console.log(`[ai-proxy test] POST ${endpoint}`);
  console.log(`[ai-proxy test] provider=${provider} prompt=${JSON.stringify(prompt)}`);

  const started = Date.now();
  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${anonKey}`,
        apikey: anonKey,
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    console.error('[ai-proxy test] Сетевая ошибка:', error?.message ?? error);
    process.exitCode = 1;
    return;
  }

  const durationMs = Date.now() - started;
  const text = await response.text().catch(() => '');
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  console.log(`[ai-proxy test] HTTP ${response.status} за ${durationMs} мс`);
  console.log('[ai-proxy test] Ответ:', JSON.stringify(data ?? text, null, 2));

  if (response.ok && data?.ok) {
    console.log(`\n✅ Успех. Провайдер: ${data.provider} (${data.model}).`);
    console.log(`Текст ответа: ${data.text}`);
    process.exitCode = 0;
    return;
  }

  console.error('\n❌ Ошибка ai-proxy:', data?.error ?? `HTTP ${response.status}`);
  process.exitCode = 1;
}

void main();
