/**
 * Lineage + generation digit (Buds 5 ≠ Buds 6, iPhone 13 ≠ 14, Pixel 7 ≠ Pixel 6,
 * Kingston Canvas Go Plus Gen4 ≠ Select Plus Gen3).
 * Used to hard-cap match score when family matches but generation/line differs.
 */

export interface LineageGeneration {
  /** e.g. buds:redmi, buds:galaxy, buds:generic, iphone, airpods, pixel, flash:canvas_go_plus */
  lineage: string;
  /** Numeric generation when available (iPhone 13 → 13, Pixel 7 → 7, Gen4 → 4). */
  gen: number;
  /**
   * Full generation token for families with letter suffixes (Pixel 9a, 10a).
   * When both sides have genKey, equality uses genKey instead of gen alone.
   */
  genKey?: string;
}

function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/\s+/g, ' ').trim();
}

function gensCompatible(a: LineageGeneration, b: LineageGeneration): boolean {
  // Unknown generation on either side → line match is enough
  if (!a.genKey || !b.genKey || a.genKey === '0' || b.genKey === '0') {
    if (a.gen > 0 && b.gen > 0) return a.gen === b.gen;
    return true;
  }
  return a.genKey === b.genKey;
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

  // Pixel 7 / Pixel 9a / Pixel 10a / Pixel 8 Pro — digit required (bare "Pixel" ignored)
  const pixel = t.match(/\b(?:google\s+)?pixel\s*(\d{1,2}[a-z]?)(?:\s*(pro|xl))?\b/i);
  if (pixel) {
    const base = pixel[1]!.toLowerCase();
    const tier = pixel[2]?.toLowerCase() ?? '';
    const gen = Number.parseInt(base, 10);
    if (!Number.isFinite(gen)) return null;
    return { lineage: 'pixel', gen, genKey: `${base}${tier}` };
  }

  // Flash / microSD product lines (Canvas Go Plus ≠ Select Plus; Gen3 ≠ Gen4)
  const flashLine = t.match(
    /\bcanvas\s*(go!?|select|react|endurance)\s*(plus)?\b/i,
  );
  if (flashLine || /\b(?:micro\s*sd|карта\s+памяти|memory\s+card)\b/i.test(t)) {
    const lineRaw = flashLine
      ? `${flashLine[1]!.replace(/!/g, '')}${flashLine[2] ? '_plus' : ''}`.toLowerCase()
      : 'flash_generic';
    const lineage = `flash:${lineRaw.replace(/\s+/g, '_')}`;
    const genMatch = t.match(/\bgen\s*([0-9]{1,2}[a-z]?)\b/i);
    if (genMatch) {
      const genKey = genMatch[1]!.toLowerCase();
      const gen = Number.parseInt(genKey, 10);
      if (Number.isFinite(gen)) return { lineage, gen, genKey };
    }
    // Line known but no gen — still encode line so Go ≠ Select when both have lineage
    if (flashLine) return { lineage, gen: 0, genKey: '0' };
  }

  return null;
}

/**
 * Same lineage + different generation → incompatible.
 * Missing extract on either side → compatible (other scorers decide).
 * Different flash lines (go_plus vs select_plus) → incompatible even if gen missing/0.
 */
export function areLineageGenerationsCompatible(
  referenceTitle: string,
  candidateTitle: string,
): boolean {
  const a = extractLineageGeneration(referenceTitle);
  const b = extractLineageGeneration(candidateTitle);
  if (!a || !b) return true;
  if (a.lineage !== b.lineage) {
    const bothBuds = a.lineage.startsWith('buds:') && b.lineage.startsWith('buds:');
    const bothFlash = a.lineage.startsWith('flash:') && b.lineage.startsWith('flash:');
    if (bothFlash) return false;
    if (!bothBuds) return true;
  }
  return gensCompatible(a, b);
}
