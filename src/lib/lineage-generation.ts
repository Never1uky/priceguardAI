/**
 * Lineage + generation digit (Buds 5 ≠ Buds 6, iPhone 13 ≠ 14).
 * Used to hard-cap match score when family matches but generation differs.
 */

export interface LineageGeneration {
  /** e.g. buds:redmi, buds:galaxy, buds:generic, iphone, airpods */
  lineage: string;
  gen: number;
}

function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Extract product-line generation from title when present. */
export function extractLineageGeneration(title: string): LineageGeneration | null {
  if (!title) return null;
  const t = normalizeTitle(title);

  const buds = t.match(/\bbuds\s*(\d{1,2})\b/);
  if (buds) {
    const gen = Number(buds[1]);
    if (/\b(?:redmi|xiaomi)\b/.test(t)) return { lineage: 'buds:redmi', gen };
    if (/\b(?:galaxy|samsung)\b/.test(t)) return { lineage: 'buds:galaxy', gen };
    return { lineage: 'buds:generic', gen };
  }

  const airpodsGen = t.match(/\bairpods\s*(\d)\b/);
  if (airpodsGen) return { lineage: 'airpods', gen: Number(airpodsGen[1]) };

  const iphone = t.match(/\biphone\s*(\d{1,2})\b/);
  if (iphone) return { lineage: 'iphone', gen: Number(iphone[1]) };

  return null;
}

/**
 * Same lineage + different generation → incompatible.
 * Missing extract on either side → compatible (other scorers decide).
 */
export function areLineageGenerationsCompatible(
  referenceTitle: string,
  candidateTitle: string,
): boolean {
  const a = extractLineageGeneration(referenceTitle);
  const b = extractLineageGeneration(candidateTitle);
  if (!a || !b) return true;
  if (a.lineage !== b.lineage) {
    // Treat generic buds as same family as branded buds when both are buds:*
    const bothBuds = a.lineage.startsWith('buds:') && b.lineage.startsWith('buds:');
    if (!bothBuds) return true;
  }
  return a.gen === b.gen;
}
