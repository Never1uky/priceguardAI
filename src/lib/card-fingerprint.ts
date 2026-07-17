/**
 * Fingerprint карточки для AI-кэша.
 * Цена не входит — dynamic overlay не должен сбрасывать analysis.
 */

import { extractProductFeatures } from '@/lib/product-features';

export function computeCardFingerprint(
  title: string,
  specs?: string,
  article?: string,
): string {
  const features = extractProductFeatures(title, specs);
  const parts = [
    features.brand ?? '',
    features.model ?? '',
    features.storage ?? '',
    features.color ?? '',
    (article ?? '').trim(),
  ]
    .map((p) => p.toLowerCase().replace(/\s+/g, ''))
    .filter(Boolean);

  if (!parts.length) {
    return title
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '')
      .slice(0, 64);
  }

  return parts.join('|').slice(0, 160);
}

export function cardFingerprintsMatch(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return true; // missing fingerprint → don't force miss (compat)
  return a === b;
}
