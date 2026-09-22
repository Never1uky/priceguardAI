/**
 * Shopping agent HTTP API (JWT).
 *
 * POST { query } → create agent_searches row, start runAgentSearch in background,
 *                  return { ok, searchId } immediately for client polling.
 * GET  /shopping-agent/:id → current row if caller owns it.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { isAgentDailyCapped, type AgentBudgetCountClient } from '../_shared/agent-budget.ts';
import { runAgentSearch } from '../_shared/agent-orchestrator.ts';
import { requireAuthUser } from '../_shared/auth.ts';
import { corsHeaders, jsonResponse } from '../_shared/utils.ts';

const MAX_QUERY_LEN = 500;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const SEARCH_SELECT =
  'id, query, constraints, status, steps_taken, cost_estimate_rub, result, error, created_at, updated_at';

function serviceClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
}

/** Keep the isolate alive after the HTTP response (Supabase EdgeRuntime). */
function runInBackground(task: Promise<unknown>): void {
  const runtime = (globalThis as unknown as {
    EdgeRuntime?: { waitUntil: (p: Promise<unknown>) => void };
  }).EdgeRuntime;
  if (runtime && typeof runtime.waitUntil === 'function') {
    runtime.waitUntil(task);
    return;
  }
  void task;
}

function extractSearchId(req: Request): string | null {
  const url = new URL(req.url);
  const fromQuery = url.searchParams.get('id')?.trim();
  if (fromQuery && UUID_RE.test(fromQuery)) return fromQuery;

  const parts = url.pathname.split('/').filter(Boolean);
  const fnIdx = parts.findIndex((p) => p === 'shopping-agent');
  const candidate = (fnIdx >= 0 ? parts[fnIdx + 1] : parts.at(-1)) ?? '';
  return UUID_RE.test(candidate) ? candidate : null;
}

function authErrorResponse(error: unknown): Response | null {
  const msg = error instanceof Error ? error.message : String(error);
  if (msg === 'auth_required' || msg === 'invalid_token') {
    return jsonResponse({ ok: false, error: 'Требуется авторизация' }, 401);
  }
  return null;
}

async function handlePost(req: Request, userId: string): Promise<Response> {
  let body: { query?: unknown };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ ok: false, error: 'Некорректный JSON' }, 400);
  }

  const query = typeof body.query === 'string' ? body.query.replace(/\s+/g, ' ').trim() : '';
  if (!query) {
    return jsonResponse({ ok: false, error: 'Укажите запрос' }, 400);
  }
  if (query.length > MAX_QUERY_LEN) {
    return jsonResponse({ ok: false, error: 'Слишком длинный запрос' }, 400);
  }

  const supabase = serviceClient();

  if (await isAgentDailyCapped(supabase as unknown as AgentBudgetCountClient, userId)) {
    return jsonResponse(
      {
        ok: false,
        code: 'agent_daily_cap',
        error: 'Дневной лимит поисков агента исчерпан. Повторите завтра.',
      },
      429,
    );
  }

  const { data, error } = await supabase
    .from('agent_searches')
    .insert({
      user_id: userId,
      query,
      status: 'pending',
      steps_taken: 0,
      cost_estimate_rub: 0,
    })
    .select('id')
    .single();

  if (error || !data?.id) {
    console.error('[shopping-agent] insert', error);
    return jsonResponse({ ok: false, error: 'Не удалось создать поиск' }, 500);
  }

  const searchId = String(data.id);
  runInBackground(
    runAgentSearch(supabase as unknown as Parameters<typeof runAgentSearch>[0], userId, query, searchId).catch((err) => {
      console.error('[shopping-agent] run', err);
    }),
  );

  return jsonResponse({ ok: true, searchId });
}

async function handleGet(req: Request, userId: string): Promise<Response> {
  const searchId = extractSearchId(req);
  if (!searchId) {
    return jsonResponse({ ok: false, error: 'Не указан id поиска' }, 400);
  }

  const supabase = serviceClient();
  const { data, error } = await supabase
    .from('agent_searches')
    .select(SEARCH_SELECT)
    .eq('id', searchId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    console.error('[shopping-agent] get', error);
    return jsonResponse({ ok: false, error: 'Не удалось получить поиск' }, 500);
  }
  if (!data) {
    return jsonResponse({ ok: false, error: 'Поиск не найден' }, 404);
  }

  return jsonResponse({ ok: true, search: data });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const user = await requireAuthUser(req, true);
    const userId = user!.id;

    if (req.method === 'POST') return await handlePost(req, userId);
    if (req.method === 'GET') return await handleGet(req, userId);
    return jsonResponse({ ok: false, error: 'Method not allowed' }, 405);
  } catch (error) {
    const auth = authErrorResponse(error);
    if (auth) return auth;
    console.error('[shopping-agent]', error);
    return jsonResponse({ ok: false, error: 'Server error' }, 500);
  }
});
