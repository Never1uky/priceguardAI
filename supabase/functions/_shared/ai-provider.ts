/**
 * Shared AITunnel / direct-provider chat completion + ai_request_log insert.
 * Extracted from ai-proxy so the shopping agent can reuse callProvider/logRequest
 * without importing the Deno.serve entrypoint.
 */

export type Provider = 'grok' | 'openai' | 'perplexity';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export const AITUNNEL_URL = 'https://api.aitunnel.ru/v1/chat/completions';

export const DIRECT_ENDPOINTS: Record<'grok' | 'openai', string> = {
  grok: 'https://api.x.ai/v1/chat/completions',
  openai: 'https://api.openai.com/v1/chat/completions',
};

export const MODELS: Record<Provider, string> = {
  grok: 'grok-3-mini',
  openai: 'gpt-4o-mini',
  perplexity: 'sonar',
};

export const DIRECT_SECRET_ENV: Record<'grok' | 'openai', string> = {
  grok: 'GROK_API_KEY',
  openai: 'OPENAI_API_KEY',
};

export type AiLogClient = {
  from: (table: string) => {
    insert: (row: Record<string, unknown>) => Promise<unknown> | unknown;
  };
};

export type CallProviderResult = {
  text: string;
  model: string;
  promptTokens?: number;
  completionTokens?: number;
};

function parseCompletionResponse(raw: string): CallProviderResult {
  const data = JSON.parse(raw) as {
    model?: string;
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const text = data.choices?.[0]?.message?.content ?? '';
  if (!text.trim()) throw new Error('empty_response');
  return {
    text,
    model: data.model ?? 'unknown',
    promptTokens: data.usage?.prompt_tokens,
    completionTokens: data.usage?.completion_tokens,
  };
}

async function postChatCompletion(
  url: string,
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  temperature: number,
  maxTokens: number | undefined,
  jsonMode: boolean,
  extraBody?: Record<string, unknown>,
): Promise<CallProviderResult> {
  const body: Record<string, unknown> = {
    model,
    temperature,
    messages,
    ...extraBody,
  };
  if (jsonMode) body.response_format = { type: 'json_object' };
  if (maxTokens) body.max_tokens = maxTokens;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`provider_${response.status}:${raw.slice(0, 200)}`);
  }

  const parsed = parseCompletionResponse(raw);
  return { ...parsed, model: parsed.model === 'unknown' ? model : parsed.model };
}

export async function callProvider(
  provider: Provider,
  messages: ChatMessage[],
  temperature: number,
  maxTokens: number | undefined,
  jsonMode: boolean,
  extraBody?: Record<string, unknown>,
): Promise<CallProviderResult> {
  const model = MODELS[provider];
  const aitunnelKey = Deno.env.get('AITUNNEL_API_KEY');

  if (aitunnelKey) {
    return postChatCompletion(
      AITUNNEL_URL,
      aitunnelKey,
      model,
      messages,
      temperature,
      maxTokens,
      jsonMode,
      extraBody,
    );
  }

  if (provider === 'perplexity') {
    throw new Error('missing_secret:AITUNNEL_API_KEY');
  }

  const directKey = Deno.env.get(DIRECT_SECRET_ENV[provider]);
  if (!directKey) {
    throw new Error(`missing_secret:${DIRECT_SECRET_ENV[provider]}`);
  }

  return postChatCompletion(
    DIRECT_ENDPOINTS[provider],
    directKey,
    model,
    messages,
    temperature,
    maxTokens,
    jsonMode,
    extraBody,
  );
}

export async function logAiRequest(
  supabase: AiLogClient,
  entry: {
    userId?: string | null;
    deviceId?: string | null;
    provider: Provider;
    model: string;
    success: boolean;
    error?: string;
    durationMs: number;
    promptTokens?: number;
    completionTokens?: number;
    pipeline?: string;
    webResearchUsed?: boolean;
    webResearchCached?: boolean;
  },
): Promise<void> {
  try {
    await supabase.from('ai_request_log').insert({
      user_id: entry.userId || null,
      device_id: entry.deviceId || null,
      provider: entry.provider,
      model: entry.model,
      success: entry.success,
      error: entry.error ? entry.error.slice(0, 500) : null,
      duration_ms: entry.durationMs,
      prompt_tokens: entry.promptTokens ?? null,
      completion_tokens: entry.completionTokens ?? null,
      pipeline: entry.pipeline ?? null,
      web_research_used: entry.webResearchUsed ?? null,
      web_research_cached: entry.webResearchCached ?? null,
    });
  } catch (e) {
    console.error('ai_request_log insert failed', e);
  }
}
