/**
 * Scrappey web scraping API — fetch HTML for antibot marketplaces.
 * Docs: POST https://publisher.scrappey.com/api/v1?key=API_KEY
 */

export interface ScraperCredentials {
  apiKey: string;
}

export interface ScrappeyFetchResult {
  html: string | null;
  error?: string;
  status?: number;
  mode?: 'request' | 'browser';
}

const DEFAULT_TIMEOUT_MS = 55_000;
const BLOCKED_RE = /Access Denied|challenge|captcha|showcaptcha/i;

function endpoint(apiKey: string): string {
  return `https://publisher.scrappey.com/api/v1?key=${encodeURIComponent(apiKey)}`;
}

function proxyCountryFor(country?: string): string {
  const c = (country ?? 'ru').toLowerCase();
  if (c === 'ru' || c === 'russia') return 'Russia';
  return country ?? 'Russia';
}

function isBlockedHtml(html: string): boolean {
  return BLOCKED_RE.test(html) && html.length < 40_000;
}

interface ScrappeyResponse {
  data?: string;
  error?: string;
  solution?: {
    statusCode?: number;
    response?: string;
  };
}

async function scrappeyRequest(
  url: string,
  apiKey: string,
  requestType: 'request' | 'browser',
  options?: { country?: string; timeoutMs?: number },
): Promise<ScrappeyFetchResult> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(endpoint(apiKey), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cmd: 'request.get',
        url,
        proxyCountry: proxyCountryFor(options?.country),
        requestType,
      }),
      signal: controller.signal,
    });

    const bodyText = await res.text().catch(() => '');
    let parsed: ScrappeyResponse;
    try {
      parsed = JSON.parse(bodyText) as ScrappeyResponse;
    } catch {
      return {
        html: null,
        status: res.status,
        error: `invalid_json:${bodyText.slice(0, 120)}`,
        mode: requestType,
      };
    }

    if (parsed.data !== 'success') {
      return {
        html: null,
        status: parsed.solution?.statusCode ?? res.status,
        error: parsed.error ?? `scrappey_${parsed.data ?? 'error'}`,
        mode: requestType,
      };
    }

    const html = parsed.solution?.response ?? '';
    const status = parsed.solution?.statusCode ?? res.status;

    if (!html || html.length < 80) {
      return { html: null, status, error: 'empty_body', mode: requestType };
    }
    if (isBlockedHtml(html)) {
      return { html: null, status, error: 'still_blocked', mode: requestType };
    }

    return { html, status, mode: requestType };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      html: null,
      error: msg.includes('abort') ? 'timeout' : `exception:${msg.slice(0, 120)}`,
      mode: requestType,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch page HTML via Scrappey (cheap request mode, then browser fallback). */
export async function fetchViaScrappey(
  url: string,
  creds: ScraperCredentials,
  options?: { country?: string; timeoutMs?: number },
): Promise<ScrappeyFetchResult> {
  const apiKey = creds.apiKey?.trim();
  if (!apiKey) {
    return { html: null, error: 'missing_credentials' };
  }
  if (!url.startsWith('http')) {
    return { html: null, error: 'invalid_url' };
  }

  const fast = await scrappeyRequest(url, apiKey, 'request', options);
  if (fast.html) return fast;

  // Cap retries: at most one browser fallback, never on timeout / 5xx / auth.
  if (fast.error === 'timeout') return fast;
  const status = fast.status ?? 0;
  if (status >= 500) return fast;

  if (fast.error !== 'still_blocked' && fast.error !== 'empty_body') {
    // Auth/billing errors — don't burn browser credits
    if (
      fast.error?.includes('invalid') ||
      fast.error?.includes('401') ||
      fast.error?.includes('403') ||
      fast.error?.includes('402')
    ) {
      return fast;
    }
  }

  const browser = await scrappeyRequest(url, apiKey, 'browser', options);
  return browser;
}

/** Probe API key with a lightweight request. */
export async function probeScrappey(
  creds: ScraperCredentials,
): Promise<{ ok: boolean; error?: string }> {
  const result = await fetchViaScrappey('https://example.com/', creds, {
    country: 'us',
    timeoutMs: 30_000,
  });
  if (result.html && result.html.length > 10) {
    return { ok: true };
  }
  if (result.error?.includes('402') || result.error?.includes('balance')) {
    return { ok: false, error: 'Недостаточно баланса Scrappey' };
  }
  if (result.error?.includes('401') || result.error?.includes('403')) {
    return { ok: false, error: 'Неверный SCRAPPEY_API_KEY' };
  }
  return { ok: false, error: result.error ?? 'Scrappey недоступен' };
}

export function keyHint(apiKey: string | null | undefined): string | null {
  const k = (apiKey ?? '').trim();
  if (k.length < 4) return null;
  return `••••${k.slice(-4)}`;
}
