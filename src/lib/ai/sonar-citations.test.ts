import { describe, expect, it } from 'vitest';

/** Зеркало логики extractUrlCitations из ai-proxy (Deno). */
function extractUrlCitations(annotations: unknown): { title: string; url: string }[] {
  if (!Array.isArray(annotations)) return [];
  const seen = new Set<string>();
  const out: { title: string; url: string }[] = [];
  for (const ann of annotations) {
    if (!ann || typeof ann !== 'object') continue;
    const item = ann as { type?: string; url_citation?: { url?: string; title?: string } };
    if (item.type !== 'url_citation') continue;
    const url = item.url_citation?.url;
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const title = item.url_citation?.title?.trim() || url;
    out.push({ title: title.slice(0, 200), url: url.slice(0, 500) });
  }
  return out.slice(0, 12);
}

describe('Sonar url_citation parsing', () => {
  it('extracts unique citations with titles', () => {
    const sources = extractUrlCitations([
      {
        type: 'url_citation',
        url_citation: { url: 'https://example.com/a', title: 'Обзор A' },
      },
      {
        type: 'url_citation',
        url_citation: { url: 'https://example.com/b', title: 'Обзор B' },
      },
      {
        type: 'url_citation',
        url_citation: { url: 'https://example.com/a', title: 'Дубликат' },
      },
    ]);
    expect(sources).toHaveLength(2);
    expect(sources[0]).toEqual({ title: 'Обзор A', url: 'https://example.com/a' });
  });

  it('falls back to url as title', () => {
    const sources = extractUrlCitations([
      { type: 'url_citation', url_citation: { url: 'https://example.com/x' } },
    ]);
    expect(sources[0].title).toBe('https://example.com/x');
  });

  it('ignores non-citation annotations', () => {
    expect(extractUrlCitations([{ type: 'other' }])).toEqual([]);
    expect(extractUrlCitations(null)).toEqual([]);
  });
});
