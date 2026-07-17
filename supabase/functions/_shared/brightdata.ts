/**
 * Bright Data Web Unlocker — fetch HTML for antibot marketplaces.
 * Docs: POST https://api.brightdata.com/request
 */

export interface BrightDataCredentials {
  apiKey: string;
  zone: string;
}

export interface BrightDataFetchResult {
  html: string | null;
  error?: string;
  status?: number;
}

const ENDPOINT = 'https://api.brightdata.com/request';
const DEFAULT_TIMEOUT_MS = 55_000;

export async function fetchViaBrightData(
  url: string,
  creds: BrightDataCredentials,
  options?: { country?: string; timeoutMs?: number },
): Promise<BrightDataFetchResult> {
  const apiKey = creds.apiKey?.trim();
  const zone = creds.zone?.trim();
  if (!apiKey || !zone) {
    return { html: null, error: 'missing_credentials' };
  }
  if (!url.startsWith('http')) {
    return { html: null, error: 'invalid_url' };
  }

  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        zone,
        url,
        format: 'raw',
        country: options?.country ?? 'ru',
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const snippet = body.slice(0, 120);
      return {
        html: null,
        status: res.status,
        error: `http_${res.status}${snippet ? `:${snippet}` : ''}`,
      };
    }

    const html = await res.text();
    if (!html || html.length < 80) {
      return { html: null, status: res.status, error: 'empty_body' };
    }
    if (/Access Denied|challenge|captcha|showcaptcha/i.test(html) && html.length < 40_000) {
      return { html: null, status: res.status, error: 'still_blocked' };
    }

    return { html, status: res.status };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      html: null,
      error: msg.includes('abort') ? 'timeout' : `exception:${msg.slice(0, 120)}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Probe credentials with Bright Data test URL (cheap). */
export async function probeBrightData(
  creds: BrightDataCredentials,
): Promise<{ ok: boolean; error?: string }> {
  const result = await fetchViaBrightData(
    'https://geo.brdtest.com/welcome.txt',
    creds,
    { country: 'us', timeoutMs: 30_000 },
  );
  if (result.html && /welcome|bright/i.test(result.html)) {
    return { ok: true };
  }
  // Any non-auth success with body also counts
  if (result.html && result.html.length > 10 && !result.error) {
    return { ok: true };
  }
  if (result.status === 401 || result.status === 403) {
    return { ok: false, error: 'Неверный API key или нет доступа к zone' };
  }
  if (result.status === 402) {
    return { ok: false, error: 'Недостаточно баланса Bright Data' };
  }
  return { ok: false, error: result.error ?? 'Bright Data недоступен' };
}

export function keyHint(apiKey: string | null | undefined): string | null {
  const k = (apiKey ?? '').trim();
  if (k.length < 4) return null;
  return `••••${k.slice(-4)}`;
}
