/**
 * Hash / redact helpers for telemetry privacy.
 */

export function hashQuery(query: string | null | undefined): string | undefined {
  const q = (query ?? '').trim().toLowerCase();
  if (!q) return undefined;
  // FNV-1a 32-bit — stable, non-reversible enough for support correlation
  let h = 0x811c9dc5;
  for (let i = 0; i < Math.min(q.length, 200); i++) {
    h ^= q.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `q${(h >>> 0).toString(16)}`;
}

export function redactUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    // drop query/hash (may contain tokens / affiliate)
    return `${u.origin}${u.pathname}`.slice(0, 200);
  } catch {
    return String(url).split('?')[0]?.slice(0, 200);
  }
}

export function truncateTitle(title: string | null | undefined, max = 80): string | undefined {
  if (!title) return undefined;
  const t = title.trim();
  if (!t) return undefined;
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

export function redactData(
  data: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!data) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    const key = k.toLowerCase();
    if (
      key.includes('prompt') ||
      key.includes('password') ||
      key.includes('token') ||
      key.includes('email') ||
      key.includes('authorization')
    ) {
      continue;
    }
    if (typeof v === 'string') {
      if (key.includes('url')) {
        out[k] = redactUrl(v) ?? v.slice(0, 200);
      } else if (key.includes('title') || key.includes('query')) {
        out[k] = truncateTitle(v, key.includes('query') ? 60 : 80);
      } else {
        out[k] = v.length > 300 ? `${v.slice(0, 299)}…` : v;
      }
    } else if (typeof v === 'number' || typeof v === 'boolean' || v == null) {
      out[k] = v;
    } else if (Array.isArray(v)) {
      out[k] = v.slice(0, 20).map((item) =>
        typeof item === 'string' ? item.slice(0, 120) : item,
      );
    } else if (typeof v === 'object') {
      out[k] = redactData(v as Record<string, unknown>);
    }
  }
  return out;
}
