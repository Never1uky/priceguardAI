/**
 * Identity fingerprint for reject / SERP exclude beyond exact URL.
 * Same SKU class (article + lineage + gen) must not reappear after reject.
 */

import type { ComparisonMarketplace } from '@/types/comparison';
import { extractLineageGeneration } from '@/lib/lineage-generation';
import { extractComparisonArticle } from '@/utils/comparison-url';

function normalizeIdentityToken(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-zа-яё0-9]+/gi, '')
    .slice(0, 48);
}

/** Stable identity key for a SERP/card candidate. */
export function offerIdentityFingerprint(
  title: string,
  url?: string,
  marketplace?: ComparisonMarketplace,
): string {
  const article =
    url && marketplace ? extractComparisonArticle(url, marketplace) : '';
  const lin = extractLineageGeneration(title);
  const line = lin?.lineage ? normalizeIdentityToken(lin.lineage) : '';
  const gen = lin?.genKey ?? (lin && lin.gen > 0 ? String(lin.gen) : '');
  const titleTok = normalizeIdentityToken(
    title
      .replace(/\b(?:карта\s+памяти|microsd(?:xc|hc)?|смартфон|телефон)\b/gi, ' ')
      .slice(0, 80),
  );
  const parts = [article, line, gen, titleTok].filter(Boolean);
  return parts.join('|') || titleTok || url?.split('?')[0]?.toLowerCase() || '';
}

export function isIdentityExcluded(
  title: string,
  url: string | undefined,
  marketplace: ComparisonMarketplace | undefined,
  rejectedFingerprints?: string[],
): boolean {
  if (!rejectedFingerprints?.length) return false;
  const fp = offerIdentityFingerprint(title, url, marketplace);
  if (!fp) return false;
  return rejectedFingerprints.some((r) => {
    if (!r) return false;
    if (r === fp) return true;
    // Same article or same lineage+gen substring
    const rParts = r.split('|');
    const fpParts = fp.split('|');
    if (rParts[0] && fpParts[0] && rParts[0] === fpParts[0] && rParts[0].length >= 5) {
      return true;
    }
    if (rParts[1] && rParts[2] && fpParts[1] === rParts[1] && fpParts[2] === rParts[2]) {
      return true;
    }
    return false;
  });
}
