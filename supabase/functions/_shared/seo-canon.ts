/**
 * SEO product group id — reuses AI canonicalProductId shape (brand|model|storage|category).
 * Edge mirror of src/lib/ai/canonical-product-id.ts (no new matching engine).
 */

import { guessBrandModelFromTitle } from './seo-slug.ts';

function normPart(s: string | undefined | null): string {
  return (s ?? '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[().,]/g, '')
    .trim();
}

/** Best-effort storage from title (128GB, 512 ГБ, etc.). */
export function guessStorageFromTitle(title: string): string {
  const m = title.match(/(\d+)\s*(?:gb|гб|tb|тб)(?![a-zа-яё])/i);
  if (!m) return '';
  const n = m[1];
  const unit = /t/i.test(m[0]) ? 'tb' : 'gb';
  return `${n}${unit}`;
}

export function buildSeoCanonId(input: {
  title: string;
  brand?: string | null;
  category?: string | null;
}): string | null {
  const guessed = guessBrandModelFromTitle(input.title);
  const brand = normPart(input.brand || guessed.brand);
  const model = normPart(guessed.model);
  if (!brand || !model) return null;
  const storage = normPart(guessStorageFromTitle(input.title));
  const category = input.category ? String(input.category) : '';
  const parts = [brand, model, storage, category].filter(Boolean);
  return `canon:${parts.join('|')}`.slice(0, 160);
}

export interface SeoPeerRow {
  slug: string;
  product_key: string;
  quality_score: number | null;
  published_at: string | null;
  is_primary?: boolean | null;
  offers_snapshot?: unknown;
  publish_status?: string;
}

/**
 * Choose primary among peers: existing is_primary, else best quality_score, else earliest published.
 */
export function chooseSeoPrimary(
  self: SeoPeerRow,
  peers: SeoPeerRow[],
): SeoPeerRow {
  const all = [self, ...peers.filter((p) => p.product_key !== self.product_key)];
  const marked = all.filter((p) => p.is_primary === true);
  if (marked.length === 1) return marked[0];
  if (marked.length > 1) {
    return [...marked].sort((a, b) => {
      const qa = a.quality_score ?? 0;
      const qb = b.quality_score ?? 0;
      if (qb !== qa) return qb - qa;
      const ta = a.published_at ? Date.parse(a.published_at) : Number.MAX_SAFE_INTEGER;
      const tb = b.published_at ? Date.parse(b.published_at) : Number.MAX_SAFE_INTEGER;
      return ta - tb;
    })[0];
  }
  return [...all].sort((a, b) => {
    const qa = a.quality_score ?? 0;
    const qb = b.quality_score ?? 0;
    if (qb !== qa) return qb - qa;
    const ta = a.published_at ? Date.parse(a.published_at) : Number.MAX_SAFE_INTEGER;
    const tb = b.published_at ? Date.parse(b.published_at) : Number.MAX_SAFE_INTEGER;
    return ta - tb;
  })[0];
}
