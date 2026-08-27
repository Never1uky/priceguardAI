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

  // iPhone 15 ≠ 15 Pro ≠ 15 Pro Max (tier in genKey, same pattern as Pixel)
  const iphone = t.match(/\biphone\s*(\d{1,2})\s*(pro\s*max|promax|pro|plus|mini)?\b/i);
  if (iphone) {
    const gen = Number(iphone[1]);
    if (!Number.isFinite(gen)) return null;
    const tierRaw = (iphone[2] ?? '').toLowerCase().replace(/\s+/g, '');
    const tier =
      tierRaw === 'promax' || tierRaw === 'pro max'
        ? 'promax'
        : tierRaw === 'pro'
          ? 'pro'
          : tierRaw === 'plus'
            ? 'plus'
            : tierRaw === 'mini'
              ? 'mini'
              : '';
    return { lineage: 'iphone', gen, genKey: `${gen}${tier}` };
  }

  // Pixel 7 / Pixel 9a / Pixel 10a / Pixel 8 Pro — digit required (bare "Pixel" ignored)
  const pixel = t.match(/\b(?:google\s+)?pixel\s*(\d{1,2}[a-z]?)(?:\s*(pro|xl))?\b/i);
  if (pixel) {
    const base = pixel[1]!.toLowerCase();
    const tier = pixel[2]?.toLowerCase() ?? '';
    const gen = Number.parseInt(base, 10);
    if (!Number.isFinite(gen)) return null;
    return { lineage: 'pixel', gen, genKey: `${base}${tier}` };
  }

  const sonyXm = t.match(/\bwh[-\s]?1000xm(\d)\b/i);
  if (sonyXm) {
    const gen = Number.parseInt(sonyXm[1]!, 10);
    if (Number.isFinite(gen)) {
      return { lineage: 'sony_wh1000xm', gen, genKey: `xm${sonyXm[1]}` };
    }
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

  // Dyson Supersonic/Airwrap families with HD model tokens (HD07/HD08).
  const dysonFamily = t.match(/\bdyson\s+(supersonic|airwrap)\b/i);
  const dysonModel = t.match(/\bhd\s*([0-9]{2})\b/i);
  if (dysonFamily && dysonModel) {
    const family = dysonFamily[1]!.toLowerCase();
    const gen = Number.parseInt(dysonModel[1]!, 10);
    if (Number.isFinite(gen)) {
      return { lineage: `dyson:${family}`, gen, genKey: `hd${dysonModel[1]}`.toLowerCase() };
    }
  }

  // Tool model tokens like GSB 18V-50.
  const toolModel = t.match(/\b([a-z]{2,5})\s*(\d{1,3}v(?:-\d{1,3})?)\b/i);
  if (toolModel) {
    const family = toolModel[1]!.toLowerCase();
    const key = `${family}${toolModel[2]!.toLowerCase().replace(/\s+/g, '')}`;
    const genNum = Number.parseInt((toolModel[2]!.match(/\d+/)?.[0] ?? '0'), 10);
    if (genNum > 0) return { lineage: `tool:${family}`, gen: genNum, genKey: key };
  }

  // Robot/home appliance model tokens with family context (S8, S7 Max, etc.).
  if (/\b(?:robot|робот|roborock|dreame|vacuum|пылесос)\b/i.test(t)) {
    const robotModel = t.match(/\b(s\d{1,2}(?:\s*(?:max|ultra|pro))?)\b/i);
    if (robotModel) {
      const key = robotModel[1]!.toLowerCase().replace(/\s+/g, '');
      const gen = Number.parseInt((key.match(/\d+/)?.[0] ?? '0'), 10);
      if (gen > 0) return { lineage: 'robot:model', gen, genKey: key };
    }
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
