/**
 * Canonical attribute normalization for cross-marketplace matching.
 * 512 GB == 512ГБ == 0.5 TB; Midnight/чёрный → black; 1 л == 1000 мл.
 */

export type ColorFamily =
  | 'black'
  | 'white'
  | 'blue'
  | 'silver'
  | 'gray'
  | 'green'
  | 'red'
  | 'gold'
  | 'purple'
  | 'pink'
  | 'beige'
  | 'brown'
  | 'orange'
  | 'yellow'
  | 'multicolor';

const COLOR_ALIASES: Record<string, ColorFamily> = {
  black: 'black',
  чёрный: 'black',
  черный: 'black',
  чёрная: 'black',
  черная: 'black',
  midnight: 'black',
  'space black': 'black',
  'spaceblack': 'black',
  'jet black': 'black',
  graphite: 'black',
  графит: 'black',
  white: 'white',
  белый: 'white',
  белая: 'white',
  'starlight': 'white',
  ivory: 'white',
  blue: 'blue',
  синий: 'blue',
  синяя: 'blue',
  navy: 'blue',
  silver: 'silver',
  серебристый: 'silver',
  серебряный: 'silver',
  gray: 'gray',
  grey: 'gray',
  серый: 'gray',
  серая: 'gray',
  green: 'green',
  зелёный: 'green',
  зеленый: 'green',
  red: 'red',
  красный: 'red',
  gold: 'gold',
  золотой: 'gold',
  purple: 'purple',
  фиолетовый: 'purple',
  violet: 'purple',
  pink: 'pink',
  розовый: 'pink',
  beige: 'beige',
  бежевый: 'beige',
  brown: 'brown',
  коричневый: 'brown',
  orange: 'orange',
  оранжевый: 'orange',
  yellow: 'yellow',
  жёлтый: 'yellow',
  желтый: 'yellow',
  lemongrass: 'yellow',
  'lemon grass': 'yellow',
  'светло-желтый': 'yellow',
  'светло-жёлтый': 'yellow',
};

/**
 * Normalize free-form storage / RAM+ROM to canonical keys:
 * - «8+256», «512gb»
 */
export function normalizeStorage(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const text = raw.toLowerCase().replace(/\u00a0/g, ' ').trim();
  if (!text) return undefined;

  const plusTb = text.match(/(\d{1,2})\s*\+\s*(\d(?:[.,]\d)?)\s*(?:тб|tb)(?![a-zа-яё])/i);
  if (plusTb) {
    const tb = Math.round(parseFloat(plusTb[2].replace(',', '.')) * 1024);
    return `${plusTb[1]}+${tb}`;
  }

  const plus = text.match(/(\d{1,2})\s*[+/]\s*(\d{2,4})\s*(?:gb|гб)?(?![a-zа-яё])/i);
  if (plus) return `${plus[1]}+${plus[2]}`;

  const ramRom = text.match(/(\d{1,2})\s*(?:gb|гб)\s*[+/]\s*(\d{2,4})\s*(?:gb|гб)(?![a-zа-яё])/i);
  if (ramRom) return `${ramRom[1]}+${ramRom[2]}`;

  const tbOnly = text.match(/(\d(?:[.,]\d)?)\s*(?:тб|tb)(?![a-zа-яё])/i);
  if (tbOnly) {
    const gb = Math.round(parseFloat(tbOnly[1].replace(',', '.')) * 1024);
    return `${gb}gb`;
  }

  const gbOnly = text.match(/(\d{2,4})\s*(?:gb|гб)(?![a-zа-яё])/i);
  if (gbOnly) return `${gbOnly[1]}gb`;

  const bare = text.match(/^(\d{1,2})\+(\d{2,4})$/);
  if (bare) return `${bare[1]}+${bare[2]}`;

  const bareGb = text.match(/^(\d{2,4})gb$/);
  if (bareGb) return `${bareGb[1]}gb`;

  return undefined;
}

/** Extract + normalize storage from title/specs blob. */
export function extractNormalizedStorage(title: string, specs?: string): string | undefined {
  const combined = `${title} ${specs ?? ''}`;
  // Prefer richest pattern via normalizeStorage on whole text chunks
  const fromCombined = normalizeStorage(combined);
  if (fromCombined) return fromCombined;

  const gbChunks = combined.match(/\d{1,2}\s*[+/]\s*\d{2,4}|\d(?:[.,]\d)?\s*(?:тб|tb)|\d{2,4}\s*(?:gb|гб)/gi);
  if (!gbChunks?.length) return undefined;
  for (const chunk of gbChunks) {
    const n = normalizeStorage(chunk);
    if (n) return n;
  }
  return undefined;
}

export function normalizeColor(raw: string | null | undefined): ColorFamily | string | undefined {
  if (!raw) return undefined;
  const lower = raw.toLowerCase().replace(/\s+/g, ' ').trim();
  if (!lower) return undefined;

  if (COLOR_ALIASES[lower]) return COLOR_ALIASES[lower];

  // Multi-word aliases
  for (const [alias, family] of Object.entries(COLOR_ALIASES)) {
    if (alias.includes(' ') && lower.includes(alias)) return family;
  }

  // Substring match for known single tokens
  for (const [alias, family] of Object.entries(COLOR_ALIASES)) {
    if (!alias.includes(' ') && (lower === alias || lower.includes(alias))) {
      return family;
    }
  }

  return lower;
}

export function extractNormalizedColor(title: string, specs?: string): string | undefined {
  const combined = `${title} ${specs ?? ''}`.toLowerCase();

  const pattern =
    /\b(space\s*black|jet\s*black|midnight|graphite|starlight|lemongrass|светло-?ж[её]лт\w*|ж[её]лт(?:ый|ая|ое)?|ч[её]рн(?:ый|ая|ое)?|бел(?:ый|ая|ое)?|син(?:ий|яя|ее)?|серебрист(?:ый|ая|ое)?|сер(?:ый|ая|ое)?|зел[её]н(?:ый|ая|ое)?|красн(?:ый|ая|ое)?|золот(?:ой|ая|ое)?|фиолетов(?:ый|ая|ое)?|розов(?:ый|ая|ое)?|бежев(?:ый|ая|ое)?|коричнев(?:ый|ая|ое)?|black|white|blue|silver|grey|gray|green|red|gold|purple|pink|beige|brown|yellow)\b/i;

  const match = combined.match(pattern);
  if (match?.[1]) return normalizeColor(match[1]) ?? undefined;

  for (const [alias, family] of Object.entries(COLOR_ALIASES)) {
    if (combined.includes(alias)) return family;
  }

  return undefined;
}

/** Volume in milliliters. */
export function normalizeVolumeMl(raw: string | null | undefined): number | undefined {
  if (!raw) return undefined;
  const text = raw.toLowerCase().replace(/\u00a0/g, ' ').replace(',', '.');

  const liters = text.match(/(\d+(?:\.\d+)?)\s*(?:л|l|литр(?:а|ов)?)(?![a-zа-яё])/i);
  if (liters) {
    const n = parseFloat(liters[1]!);
    if (Number.isFinite(n) && n > 0) return Math.round(n * 1000);
  }

  const ml = text.match(/(\d+(?:\.\d+)?)\s*(?:мл|ml)(?![a-zа-яё])/i);
  if (ml) {
    const n = parseFloat(ml[1]!);
    if (Number.isFinite(n) && n > 0) return Math.round(n);
  }

  return undefined;
}

export function extractNormalizedVolumeMl(title: string, specs?: string): number | undefined {
  return normalizeVolumeMl(`${title} ${specs ?? ''}`);
}

/** Weight in grams. */
export function normalizeWeightG(raw: string | null | undefined): number | undefined {
  if (!raw) return undefined;
  const text = raw.toLowerCase().replace(/\u00a0/g, ' ').replace(',', '.');

  const kg = text.match(/(\d+(?:\.\d+)?)\s*(?:кг|kg)\b/);
  if (kg) {
    const n = parseFloat(kg[1]!);
    if (Number.isFinite(n) && n > 0) return Math.round(n * 1000);
  }

  const g = text.match(/(\d+(?:\.\d+)?)\s*(?:г|g|гр|грамм(?:а|ов)?)\b/);
  if (g) {
    const n = parseFloat(g[1]!);
    // Avoid matching "5G" network — require unit word or standalone
    if (/г(?:р|рамм)|(?<![a-z])g(?:ram)?s?\b/i.test(g[0]!) || /г\b/.test(g[0]!)) {
      if (Number.isFinite(n) && n > 0 && n < 100_000) return Math.round(n);
    }
  }

  return undefined;
}

export function extractNormalizedWeightG(title: string, specs?: string): number | undefined {
  const combined = `${title} ${specs ?? ''}`;
  // Prefer explicit кг / грамм over bare «г» next to 5G
  const kg = combined.match(/(\d+(?:[.,]\d+)?)\s*(?:кг|kg)\b/i);
  if (kg) return normalizeWeightG(kg[0]);

  const grams = combined.match(/(\d+(?:[.,]\d+)?)\s*(?:грамм(?:а|ов)?|гр\.?|г(?![a-zа-яё]))\b/i);
  if (grams) return normalizeWeightG(grams[0].replace(/г(?![a-zа-яё])/i, 'г'));

  return normalizeWeightG(combined);
}

/** Package / multipack count. */
export function normalizePackageCount(raw: string | null | undefined): number | undefined {
  if (!raw) return undefined;
  const text = raw.toLowerCase().replace(/\u00a0/g, ' ');

  const patterns = [
    /(\d+)\s*(?:шт|pcs|pc)(?![a-zа-яё])/i,
    /уп\.?\s*(?:по\s*)?(\d+)/i,
    /(\d+)\s*(?:в\s*)?уп/i,
    /x\s*(\d+)\b/i,
    /(\d+)\s*pack\b/i,
  ];

  for (const re of patterns) {
    const m = text.match(re);
    if (m?.[1]) {
      const n = parseInt(m[1], 10);
      if (n >= 2 && n <= 500) return n;
    }
  }

  return undefined;
}

export function extractNormalizedPackageCount(title: string, specs?: string): number | undefined {
  return normalizePackageCount(`${title} ${specs ?? ''}`);
}

/** Apparel/shoes size — soft variant, not product identity. */
export function normalizeSize(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const text = raw.toLowerCase().replace(/\u00a0/g, ' ').trim();

  const letter = text.match(/\b(xxs|xs|s|m|l|xl|xxl|xxxl|2xl|3xl)\b/i);
  if (letter?.[1]) return letter[1].toUpperCase().replace('2XL', 'XXL').replace('3XL', 'XXXL');

  const eu = text.match(/\b(?:размер|size)?\s*(\d{2}(?:[,.]\d)?)\b/i);
  if (eu?.[1]) {
    const n = parseFloat(eu[1].replace(',', '.'));
    if (n >= 20 && n <= 60) return String(n).replace('.0', '');
  }

  return undefined;
}

export function extractNormalizedSize(title: string, specs?: string): string | undefined {
  const combined = `${title} ${specs ?? ''}`;
  const explicit = combined.match(
    /(?:размер|size)[:\s]*([xxsml]{1,4}|\d{2}(?:[,.]\d)?)/i,
  );
  if (explicit?.[1]) return normalizeSize(explicit[1]);

  // Standalone letter sizes common in apparel titles
  const letter = combined.match(/[,\s]([SML]|XS|XXL|XL|XXS)(?:[,\s]|$)/i);
  if (letter?.[1]) return normalizeSize(letter[1]);

  return normalizeSize(combined);
}

const MATERIAL_ALIASES: Record<string, string> = {
  cotton: 'cotton',
  хлопок: 'cotton',
  polyester: 'polyester',
  полиэстер: 'polyester',
  leather: 'leather',
  кожа: 'leather',
  экокожа: 'leather',
  suede: 'suede',
  замша: 'suede',
  wool: 'wool',
  шерсть: 'wool',
  nylon: 'nylon',
  нейлон: 'nylon',
};

export function normalizeMaterial(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const lower = raw.toLowerCase().trim();
  for (const [alias, canon] of Object.entries(MATERIAL_ALIASES)) {
    if (lower.includes(alias)) return canon;
  }
  return undefined;
}

export function extractNormalizedMaterial(title: string, specs?: string): string | undefined {
  return normalizeMaterial(`${title} ${specs ?? ''}`);
}

export function colorsCompatible(
  a: string | undefined,
  b: string | undefined,
): boolean | 'unknown' {
  if (!a || !b) return 'unknown';
  return normalizeColor(a) === normalizeColor(b);
}

export function storageCompatible(
  a: string | undefined,
  b: string | undefined,
): boolean | 'unknown' {
  if (!a || !b) return 'unknown';
  const na = normalizeStorage(a) ?? a;
  const nb = normalizeStorage(b) ?? b;
  return na === nb;
}
