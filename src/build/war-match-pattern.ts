/**
 * Chrome MV3 `web_accessible_resources.matches` may only use origin + `/*`.
 * Path patterns (e.g. `/catalog/*`) cause: Invalid match pattern.
 * @see https://developer.chrome.com/docs/extensions/reference/manifest/web-accessible-resources
 */

/** Convert a content-script match pattern to a WAR-safe origin match. */
export function toWarOriginMatch(pattern: string): string | null {
  const trimmed = pattern.trim();
  if (!trimmed) return null;
  if (trimmed === '<all_urls>') return '<all_urls>';

  const m = /^([a-z*]+):\/\/([^/]+)(\/.*)?$/i.exec(trimmed);
  if (!m) return null;
  const scheme = m[1];
  const host = m[2];
  if (!scheme || !host) return null;
  return `${scheme}://${host}/*`;
}

/** Dedupe content-script matches into WAR-safe origin patterns. */
export function contentMatchesToWarOrigins(patterns: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of patterns) {
    const origin = toWarOriginMatch(p);
    if (!origin || seen.has(origin)) continue;
    seen.add(origin);
    out.push(origin);
  }
  return out;
}
