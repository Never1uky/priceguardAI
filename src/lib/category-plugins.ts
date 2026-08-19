/**
 * Single registry per product category: inference, match profile, query cleanup, penalties.
 * Adding a category = one plugin entry here (+ MODEL_PATTERNS in model-extract.ts if needed).
 */

import type { CategoryMatchProfile, ProductCategory } from '@/lib/match-category';
import type { ProductRole } from '@/lib/match-rules/types';

export interface CategoryPlugin {
  id: ProductCategory;
  /** Ordered inference rules — first plugin match wins (specific → broad). */
  inferPatterns: RegExp[];
  profile: CategoryMatchProfile;
  /** Default product role for SKUs in this category. */
  roleDefault?: ProductRole;
  /** Host-family markers often present as compatibility context (not the SKU itself). */
  hostHints?: RegExp[];
  /** Cross-marketplace SERP query cleanup */
  stripQueryNoise?: (text: string) => string;
  /** Query lead policy for dependents. */
  queryPolicy?: {
    /** Never allow compatibility host alone as SERP lead. */
    forbidHostAsLead?: boolean;
    /** Prefer entity-extract primary entity for query. */
    preferPrimaryEntity?: boolean;
  };
  /** Optional score penalty (0–1) applied after feature match */
  mismatchPenalty?: (referenceTitle: string, candidateTitle: string) => number;
}

const ELECTRONICS_LITE: CategoryMatchProfile = {
  weights: {
    brand: 40,
    model: 35,
    storage: 15,
    color: 5,
    price: 5,
    title: 25,
  },
  required: ['brand', 'model'],
  soft: [],
  ignore: [],
};

/** Убрать kit-объектив из поискового запроса камер. */
export function stripCameraKitNoise(text: string): string {
  return text
    .replace(/\b(?:kit|body|body\s*only)\b/gi, ' ')
    .replace(/\b(?:ef-?s?|rf-?s?|e-?|fe)\s*\d{1,3}[-–]\d{2,3}\s*mm\b/gi, ' ')
    .replace(/\b\d{1,3}[-–]\d{2,3}\s*mm\b/gi, ' ')
    .replace(/\b(?:объектив|линза|lens)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractCameraBodyKey(title: string): string | null {
  const m =
    title.match(/\bcanon\s+eos\s*(\d{3,4})\s*d?\b/i) ??
    title.match(/\beos\s*(\d{3,4})\s*d\b/i) ??
    title.match(/\bcanon\s+(\d{3,4})\s*d\b/i) ??
    title.match(/\bnikon\s+d(\d{3,4})\b/i);
  if (!m) return null;
  return m[0].toLowerCase().replace(/\s+/g, '');
}

/** Штраф за разные body-модели камер (650D ≠ 600D). */
export function cameraBodyMismatchPenalty(referenceTitle: string, candidateTitle: string): number {
  const a = extractCameraBodyKey(referenceTitle);
  const b = extractCameraBodyKey(candidateTitle);
  if (!a || !b || a === b) return 0;
  return 0.65;
}

const LAPTOP_HINT = /ноутбук|laptop|macbook|notebook|ultrabook/i;
const GPU_OR_DESKTOP_INTRUDER =
  /видеокарт|\bgpu\b|графическ|трафарет|наклейк|стикер|системн\w*\s*блок|игровой\s+компьютер|пк\s+сборк/i;

/** Primary device — do not classify as accessory when present. */
const PRIMARY_DEVICE_HINT =
  /смартфон|ноутбук|laptop|macbook|notebook|ultrabook|телевизор|\bsmart\s*tv\b|монитор|\bmonitor\b/i;

const ACCESSORY_HINT =
  /чехол|защитн\w*\s+(?:стекл|плёнк|пленк)|плёнк|пленк|кабель|зарядк|зарядн|держатель|подставк|сумк\w*\s+для\s+(?:ноут|laptop)|сумка\s+для\s+ноут/i;

/** Case / film / cable vs phone or laptop — near hard reject. */
export function accessoryCrossCategoryPenalty(referenceTitle: string, candidateTitle: string): number {
  const refAcc = ACCESSORY_HINT.test(referenceTitle) && !PRIMARY_DEVICE_HINT.test(referenceTitle);
  const candAcc = ACCESSORY_HINT.test(candidateTitle) && !PRIMARY_DEVICE_HINT.test(candidateTitle);
  if (refAcc !== candAcc) return 0.95;
  return 0;
}

/** Laptop vs GPU / desktop PC / stencil accessories — near hard reject. */
export function laptopCrossCategoryPenalty(_referenceTitle: string, candidateTitle: string): number {
  if (LAPTOP_HINT.test(candidateTitle)) return 0;
  if (GPU_OR_DESKTOP_INTRUDER.test(candidateTitle)) return 0.95;
  if (ACCESSORY_HINT.test(candidateTitle) && !PRIMARY_DEVICE_HINT.test(candidateTitle)) return 0.95;
  return 0;
}

export function gpuCrossCategoryPenalty(_referenceTitle: string, candidateTitle: string): number {
  if (/видеокарт|\bgpu\b|графическ/i.test(candidateTitle) && !LAPTOP_HINT.test(candidateTitle)) {
    return 0;
  }
  if (LAPTOP_HINT.test(candidateTitle) || /игровой\s+компьютер|системн\w*\s*блок/i.test(candidateTitle)) {
    return 0.95;
  }
  return 0;
}

export function desktopCrossCategoryPenalty(_referenceTitle: string, candidateTitle: string): number {
  if (/игровой\s+компьютер|системн\w*\s*блок|\bdesktop\b/i.test(candidateTitle) && !LAPTOP_HINT.test(candidateTitle)) {
    return 0;
  }
  if (LAPTOP_HINT.test(candidateTitle) || /видеокарт|\bgpu\b|трафарет/i.test(candidateTitle)) {
    return 0.95;
  }
  return 0;
}

export function tvCrossCategoryPenalty(_referenceTitle: string, candidateTitle: string): number {
  if (/телевизор|\bsmart\s*tv\b|\bUE\d{2}|\bQN\d{2}/i.test(candidateTitle)) return 0;
  if (/монитор|\bmonitor\b/i.test(candidateTitle) && !/телевизор/i.test(candidateTitle)) return 0.95;
  if (ACCESSORY_HINT.test(candidateTitle) && !PRIMARY_DEVICE_HINT.test(candidateTitle)) return 0.95;
  return 0;
}

export function monitorCrossCategoryPenalty(_referenceTitle: string, candidateTitle: string): number {
  if (/монитор|\bmonitor\b/i.test(candidateTitle) && !/телевизор/i.test(candidateTitle)) return 0;
  if (/телевизор|\bsmart\s*tv\b/i.test(candidateTitle)) return 0.95;
  return 0;
}

/** Categories that must not match each other (hard reject in scoreProductMatch). */
const INCOMPATIBLE_CATEGORY_PAIRS = new Set([
  'laptops|gpus',
  'gpus|laptops',
  'laptops|desktops',
  'desktops|laptops',
  'gpus|desktops',
  'desktops|gpus',
  'smartphones|accessories',
  'accessories|smartphones',
  'laptops|accessories',
  'accessories|laptops',
  'tvs|accessories',
  'accessories|tvs',
  'tvs|monitors',
  'monitors|tvs',
  'monitors|accessories',
  'accessories|monitors',
  'cameras|appliances',
  'appliances|cameras',
  'cameras|accessories',
  'accessories|cameras',
  'headphones|smartphones',
  'smartphones|headphones',
  'wearables|smartphones',
  'smartphones|wearables',
  'headphones|wearables',
  'wearables|headphones',
]);

export function areCategoriesIncompatible(a: ProductCategory, b: ProductCategory): boolean {
  if (a === b) return false;
  // Same policy as compare-merge: different non-generic categories never match
  if (a !== 'generic' && b !== 'generic') return true;
  return INCOMPATIBLE_CATEGORY_PAIRS.has(`${a}|${b}`);
}

/** Fallback profile when no category rule matches. */
export const GENERIC_MATCH_PROFILE: CategoryMatchProfile = ELECTRONICS_LITE;

/**
 * Plugin list — order matters for inferProductCategory (first hit wins).
 * Accessories / TVs / monitors before smartphones & laptops so «Чехол для iPhone»
 * is not classified as a phone. `generic` is not listed; uses GENERIC_MATCH_PROFILE only.
 */
export const CATEGORY_PLUGINS: CategoryPlugin[] = [
  {
    id: 'memory_cards',
    roleDefault: 'primary',
    inferPatterns: [
      /micro\s*sd(?:xc|hc)?/i,
      /\bsd\s*xc\b/i,
      /\bsd\s*card\b/i,
      /карта\s+памяти/i,
      /флеш[-\s]?карт/i,
      /memory\s+card/i,
      /\bcanvas\s+go\b/i,
      /\bcanvas\s+select\b/i,
    ],
    profile: {
      weights: {
        brand: 25,
        model: 45,
        storage: 25,
        price: 5,
        title: 20,
      },
      required: ['brand', 'model'],
      soft: [],
      ignore: ['color', 'size', 'volume', 'weight', 'packageCount', 'gender'],
    },
  },
  {
    id: 'accessories',
    roleDefault: 'accessory',
    queryPolicy: { forbidHostAsLead: true, preferPrimaryEntity: true },
    hostHints: [
      /\bplaystation\b/i,
      /\bps\s*[45]\b/i,
      /\bxbox\b/i,
      /\biphone\b/i,
      /\bgalaxy\b/i,
    ],
    inferPatterns: [
      // Console controllers / gamepads (before consoles plugin matches «PlayStation 5» in title)
      /\bdual\s*sense\b/i,
      /\bdualshock\b/i,
      /геймпад|джойстик/i,
      /беспроводн\w*\s+контроллер/i,
      /контроллер\s+для\s+(?:playstation|xbox|switch|приставк)/i,
      // Camera batteries / bags — before cameras plugin matches «Nikon D5100» in accessory titles
      /(?:аккумулятор|батаре\w*|battery)/i,
      /(?:чехол|сумк\w*).{0,40}(?:фото|nikon|canon|sony|fujifilm|dslr|\bd\d{3,4}\b)/i,
      /(?:для\s+(?:фотоаппарат|камеры|nikon|canon)).{0,24}(?:чехол|сумк)/i,
      // Accessory keyword without primary device word (смартфон/ноутбук/…)
      /(?!.*(?:смартфон|ноутбук|laptop|macbook|телевизор|монитор)).*(?:чехол|защитн\w*\s+(?:стекл|плёнк|пленк)|плёнк|пленк|кабель\s+(?:usb|type|type-c|lightning)|зарядк|зарядн(?:ое|ый)\s+(?:устрой|блок)|держатель|подставк|сумк\w*\s+для\s+(?:ноут|laptop))/i,
      /чехол\s+для\s+(?:iphone|galaxy|samsung|xiaomi|redmi|телефон|смартфон|ноут)/i,
      /(?:стекл|плёнк|пленк).{0,24}(?:iphone|galaxy|samsung|xiaomi)/i,
      /сумка\s+для\s+ноут/i,
      /подставк\w*\s+для\s+ноут/i,
    ],
    profile: {
      weights: {
        brand: 25,
        model: 25,
        connector: 25,
        authenticity: 15,
        condition: 10,
        color: 10,
        title: 30,
        price: 10,
      },
      required: ['connector'],
      soft: ['color', 'storage'],
      ignore: ['size', 'volume', 'packageCount'],
    },
    mismatchPenalty: accessoryCrossCategoryPenalty,
    stripQueryNoise: (text) =>
      text
        // Strip host/platform tokens from accessory lead queries
        .replace(/\b(?:playstation\s*[45]?|ps\s*[45]|xbox(?:\s+series\s*[xs]?)?|nintendo\s+switch|приставк\w*)\b/gi, ' ')
        .replace(/\b(?:для|for|совместим\w*)\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
  },
  {
    id: 'tvs',
    inferPatterns: [
      /телевизор/i,
      /\bsmart\s*tv\b/i,
      /\bUE\d{2}/i,
      /\bQN\d{2}/i,
      /\bOLED\s*(?:TV|телевизор)/i,
      /\bQLED\b/i,
    ],
    profile: {
      weights: {
        brand: 30,
        model: 35,
        title: 25,
        price: 10,
      },
      required: ['brand', 'model'],
      soft: ['color'],
      ignore: ['storage', 'size', 'volume', 'packageCount'],
    },
    mismatchPenalty: tvCrossCategoryPenalty,
    stripQueryNoise: (text) =>
      text
        .replace(/\b(?:телевизор|smart\s*tv|tv)\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
  },
  {
    id: 'monitors',
    inferPatterns: [
      /монитор/i,
      /\bmonitor\b/i,
      /\bgaming\s+monitor\b/i,
    ],
    profile: {
      weights: {
        brand: 30,
        model: 35,
        title: 25,
        price: 10,
      },
      required: ['brand', 'model'],
      soft: ['color'],
      ignore: ['storage', 'size', 'volume', 'packageCount'],
    },
    mismatchPenalty: monitorCrossCategoryPenalty,
  },
  {
    id: 'smartphones',
    roleDefault: 'primary',
    inferPatterns: [
      /смартфон/i,
      /телефон/i,
      /\biphone\b/i,
      /\bphone\b/i,
      /\bredmi\b/i,
      /\brealme\b/i,
      /\bpoco\b/i,
      /\bgalaxy\s*[as]\d/i,
    ],
    profile: {
      weights: {
        brand: 30,
        model: 40,
        storage: 20,
        region: 10,
        condition: 10,
        // Soft preference only — must not outweigh model/lineage or cheap-rank
        color: 3,
        price: 5,
        title: 20,
      },
      required: ['brand', 'model'],
      soft: ['color'],
      ignore: ['size', 'volume', 'weight', 'packageCount'],
    },
    mismatchPenalty: accessoryCrossCategoryPenalty,
  },
  {
    id: 'gpus',
    inferPatterns: [
      /видеокарт/i,
      /\bgpu\b/i,
      /графическ(ая|ий)\s*(карт|процессор)/i,
      /трафарет.{0,24}rtx/i,
      /наклейк.{0,24}rtx/i,
    ],
    profile: {
      weights: {
        brand: 30,
        model: 40,
        color: 5,
        price: 10,
        title: 25,
      },
      required: ['brand', 'model'],
      soft: ['color'],
      ignore: ['storage', 'size', 'volume', 'packageCount'],
    },
    mismatchPenalty: gpuCrossCategoryPenalty,
    stripQueryNoise: (text) =>
      text
        .replace(/\b(?:видеокарта|gpu|graphics\s*card)\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
  },
  {
    id: 'desktops',
    inferPatterns: [
      /системн(ый|ого)\s*блок/i,
      /игровой\s+компьютер/i,
      /\bdesktop\b/i,
      /пк\s+игровой/i,
      /игровой\s+пк\b/i,
    ],
    profile: {
      weights: {
        brand: 25,
        model: 30,
        storage: 15,
        color: 5,
        price: 10,
        title: 25,
      },
      required: ['brand', 'model'],
      soft: ['color'],
      ignore: ['size', 'volume', 'packageCount'],
    },
    mismatchPenalty: desktopCrossCategoryPenalty,
  },
  {
    id: 'laptops',
    inferPatterns: [
      /ноутбук/i,
      /\blaptop\b/i,
      /\bmacbook\b/i,
      /\bnotebook\b/i,
      /\bultrabook\b/i,
    ],
    profile: {
      weights: {
        brand: 25,
        model: 30,
        storage: 20,
        region: 10,
        condition: 10,
        color: 5,
        price: 5,
        title: 25,
      },
      required: ['brand', 'model'],
      soft: ['color'],
      ignore: ['size', 'volume', 'packageCount'],
    },
    mismatchPenalty: laptopCrossCategoryPenalty,
  },
  {
    id: 'headphones',
    inferPatterns: [
      /наушник/i,
      /\bheadphones?\b/i,
      /\bearbuds?\b/i,
      /\bairpods\b/i,
      /\bgalaxy\s*buds/i,
      /\bheadset\b/i,
    ],
    profile: {
      weights: {
        brand: 30,
        model: 40,
        connector: 20,
        authenticity: 15,
        condition: 10,
        color: 10,
        price: 5,
        title: 25,
      },
      required: ['brand', 'model', 'connector'],
      soft: ['color'],
      ignore: ['storage', 'size', 'volume', 'packageCount'],
    },
    stripQueryNoise: (text) =>
      text
        .replace(/\b(?:наушники|earbuds?|headphones?|headset|гарнитура)\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
  },
  {
    id: 'wearables',
    inferPatterns: [
      /умные\s+часы/i,
      /фитнес\s*[-\s]?браслет/i,
      /smart\s*band/i,
      /\bamazfit\b/i,
      /\bmi\s*band\b/i,
      /xiaomi\s+smart\s+band/i,
      /\bgalaxy\s*watch\b/i,
      /apple\s+watch/i,
      /смарт\s*[-\s]?часы/i,
    ],
    profile: {
      weights: {
        brand: 30,
        model: 40,
        series: 10,
        color: 10,
        price: 5,
        title: 25,
      },
      required: ['brand', 'model'],
      soft: ['color'],
      ignore: ['storage', 'size', 'volume', 'packageCount', 'weight'],
    },
    stripQueryNoise: (text) =>
      text
        .replace(
          /\b(?:умные\s+часы|фитнес\s*[-\s]?браслет|smart\s*band|смарт\s*[-\s]?часы)\b/gi,
          ' ',
        )
        .replace(/\s+/g, ' ')
        .trim(),
  },
  {
    id: 'lenses',
    inferPatterns: [
      /\bобъектив\b/i,
      /\blens\b/i,
      /\b(?:ef|rf|e)\s*-?\s*\d{1,3}\s*mm\b/i,
      /\b\d{1,3}\s*[-–]\s*\d{2,3}\s*mm\s*f\/?\d/i,
    ],
    profile: {
      weights: {
        brand: 30,
        model: 40,
        series: 10,
        color: 5,
        price: 5,
        title: 20,
      },
      required: ['brand', 'model'],
      soft: ['color', 'title'],
      ignore: ['storage', 'size', 'volume', 'packageCount', 'weight', 'gender'],
    },
    stripQueryNoise: (text) =>
      text
        .replace(/\b(?:объектив|линза|lens)\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
  },
  {
    id: 'cameras',
    inferPatterns: [
      // Skip accessory/part leads that mention a camera model (e.g. «Аккумулятор … Nikon D5100»)
      /(?!.*(?:аккумулятор|батаре\w*|battery|чехол|сумк\w*\s+для)).*(?:фотоаппарат)/i,
      /(?!.*(?:аккумулятор|батаре\w*|battery|чехол|сумк\w*\s+для)).*(?:зеркал)/i,
      /(?!.*(?:аккумулятор|батаре\w*|battery|чехол|сумк\w*\s+для)).*(?:беззеркал)/i,
      /(?!.*(?:аккумулятор|батаре\w*|battery|чехол|сумк\w*\s+для)).*\bdslr\b/i,
      /(?!.*(?:аккумулятор|батаре\w*|battery|чехол|сумк\w*\s+для)).*\bmirrorless\b/i,
      /(?!.*(?:аккумулятор|батаре\w*|battery|чехол|сумк\w*\s+для)).*\bcanon\s+eos\b/i,
      /(?!.*(?:аккумулятор|батаре\w*|battery|чехол|сумк\w*\s+для)).*\bnikon\s+d\d/i,
      /(?!.*(?:аккумулятор|батаре\w*|battery|чехол|сумк\w*\s+для)).*\bsony\s+(?:alpha|α)\s*\d/i,
      /(?!.*(?:аккумулятор|батаре\w*|battery|чехол|сумк\w*\s+для)).*\bfujifilm\s+x-?[st]\d/i,
    ],
    profile: {
      weights: {
        brand: 30,
        model: 45,
        series: 10,
        color: 5,
        price: 5,
        title: 25,
      },
      required: ['brand', 'model'],
      soft: ['color', 'title'],
      ignore: ['storage', 'size', 'volume', 'packageCount', 'weight'],
    },
    stripQueryNoise: stripCameraKitNoise,
    mismatchPenalty: cameraBodyMismatchPenalty,
  },
  {
    id: 'consoles',
    roleDefault: 'primary',
    inferPatterns: [
      /игровая\s+приставк/i,
      /\bplaystation\s*\d\b/i,
      /\bps\s*[45]\b/i,
      /\bxbox\s+series\b/i,
      /\bnintendo\s+switch\b/i,
      /\bsteam\s+deck\b/i,
    ],
    profile: {
      weights: {
        brand: 25,
        model: 45,
        series: 10,
        color: 10,
        price: 5,
        title: 20,
      },
      required: ['brand', 'model'],
      soft: ['color'],
      ignore: ['storage', 'size', 'volume', 'packageCount', 'weight'],
    },
    stripQueryNoise: (text) =>
      text
        .replace(/\b(?:игровая\s+)?(?:приставка|console|консоль)\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
  },
  {
    id: 'networking',
    inferPatterns: [
      /точка\s+доступа/i,
      /\baccess\s*point\b/i,
      /маршрутизатор/i,
      /\bроутер\b|\brouter\b/i,
      /\bmesh\s*(?:wifi|wi-?fi|system|система)?\b/i,
      /\bwi-?fi\s*[67]\b/i,
      /\bax\d{3,4}\b/i,
      /\bap\d{3,4}\b/i,
      /outdoor\s+ax/i,
      /\b(?:cudy|tp-?link|keenetic|mikrotik|ubiquiti|asus\s+rt-)\b/i,
    ],
    profile: {
      weights: {
        brand: 35,
        model: 40,
        series: 10,
        price: 5,
        title: 20,
      },
      required: ['brand', 'model'],
      soft: ['color'],
      ignore: ['storage', 'size', 'volume', 'gender'],
    },
    stripQueryNoise: (text) =>
      text
        .replace(/\b(?:точка\s+доступа|access\s*point|роутер|router|маршрутизатор)\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
  },
  {
    id: 'power_tools',
    roleDefault: 'primary',
    inferPatterns: [
      /дрель/i,
      /шурупов/i,
      /перфоратор/i,
      /болгарк/i,
      /лобзик/i,
      /шлифмашин/i,
      /садов/i,
      /газонокосил/i,
      /культиватор/i,
      /barbecue|барбекю/i,
      /гриль/i,
      /\bgsb\s*\d/i,
      /\bdcd\d/i,
      /\b(?:bosch|makita|metabo|deko|интерскол)\s+[a-z]{2,5}[\s-]?\d{3,5}/i,
    ],
    profile: {
      weights: {
        brand: 35,
        model: 40,
        series: 10,
        price: 5,
        title: 20,
      },
      required: ['brand', 'model'],
      soft: ['color'],
      ignore: ['storage', 'size', 'volume', 'gender'],
    },
    stripQueryNoise: (text) =>
      text
        .replace(/\b(?:дрель|шурупов[её]рт|перфоратор|болгарка|лобзик|шлифмашина)\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
  },
  {
    id: 'appliances',
    roleDefault: 'primary',
    inferPatterns: [
      /стиральная\s+машин/i,
      /робот[-\s]?пылесос/i,
      /робот\s+пылесос/i,
      /\broborock\b/i,
      /\bdreame\b/i,
      /мультивар/i,
      /холодильник/i,
      /пылесос/i,
      /микроволнов/i,
      /посудомо/i,
      /кондиционер(?!\s+для\s+бель)/i,
      /вытяжк/i,
      /варочн/i,
      /духов/i,
      /чайник/i,
      /фен(?!\s+для)/i,
      /зубн(?:ая|ой)\s+щ[её]тк/i,
      /электрическ\w*\s+щ[её]тк/i,
      /\boral[\s-]?b\b/i,
      /бытов(?:ая|ой)\s+техник/i,
    ],
    profile: {
      weights: {
        brand: 30,
        model: 35,
        series: 15,
        volume: 10,
        weight: 10,
        price: 5,
        title: 20,
      },
      required: ['brand'],
      soft: ['color', 'volume', 'weight'],
      ignore: ['storage', 'size', 'gender'],
    },
    stripQueryNoise: (text) =>
      text
        .replace(
          /\b(?:стиральная\s+машина|робот[-\s]?пылесос|робот\s+пылесос|мультивар(?:ка)?|холодильник|пылесос|микроволнов(?:ая|ка)|посудомо(?:ечная|йка)|чайник|фен)\b/gi,
          ' ',
        )
        .replace(/\s+/g, ' ')
        .trim(),
  },
  {
    id: 'home_textile',
    inferPatterns: [
      /постельн/i,
      /комплект\s+постель/i,
      /простын/i,
      /пододеяльник/i,
      /наволочк/i,
      /полотенц/i,
      /плед/i,
      /покрывал/i,
      /одеяло/i,
      /подушк(?!\s+декор)/i,
    ],
    profile: {
      weights: {
        brand: 25,
        series: 25,
        model: 15,
        color: 15,
        material: 10,
        title: 25,
        price: 5,
        size: 0,
      },
      required: ['brand'],
      soft: ['size', 'color', 'model'],
      ignore: ['storage', 'volume', 'packageCount', 'gender'],
    },
    stripQueryNoise: (text) =>
      text
        .replace(
          /\b(?:постельное\s+бель[её]|комплект\s+постель|простын(?:я|и)?|пододеяльник|наволочк(?:а|и)?|полотенц(?:е|о|а)?|плед|покрывал(?:о|а)?|одеяло)\b/gi,
          ' ',
        )
        .replace(/\b(?:1[,.]?\s*5|2[-\s]?sp|евро|семейн)\s*(?:спальн)?\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
  },
  {
    id: 'home_goods',
    inferPatterns: [
      /органайзер/i,
      /контейнер\s+для\s+хранен/i,
      /кастрюл/i,
      /сковород/i,
      /посуда/i,
      /тарелк/i,
      /чаш(?:ка|ки)/i,
      /стакан/i,
      /ваза/i,
      /декор/i,
      /сервиз/i,
    ],
    profile: {
      weights: {
        brand: 25,
        series: 25,
        model: 15,
        color: 15,
        material: 10,
        title: 25,
        price: 5,
      },
      required: ['brand'],
      soft: ['model', 'color'],
      ignore: ['storage', 'size', 'volume', 'gender', 'packageCount'],
    },
    stripQueryNoise: (text) =>
      text
        .replace(
          /\b(?:органайзер|кастрюл(?:я|и)?|сковород(?:а|ы)?|посуда|тарелк(?:а|и)?|сервиз|декор)\b/gi,
          ' ',
        )
        .replace(/\s+/g, ' ')
        .trim(),
  },
  {
    id: 'kids',
    inferPatterns: [
      /детск(?:ая|ие|ий|ое|ого|ому)/i,
      /для\s+дет/i,
      /для\s+малыш/i,
      /подгузник/i,
      /пампер/i,
      /\bkids?\b/i,
      /новорожд/i,
    ],
    profile: {
      weights: {
        brand: 25,
        model: 25,
        color: 15,
        gender: 10,
        material: 10,
        title: 25,
        price: 5,
        size: 0,
      },
      required: ['brand'],
      soft: ['size', 'gender', 'model'],
      ignore: ['storage', 'volume', 'packageCount'],
    },
    stripQueryNoise: (text) =>
      text
        .replace(/\b(?:детск(?:ая|ие|ий|ое)|для\s+дет(?:ей|ей)?|для\s+малыш(?:ей|а)?|подгузник(?:и|ов)?)\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
  },
  {
    id: 'sports',
    inferPatterns: [
      /протеин/i,
      /спорт(?:ив)?(?:ное\s+)?питан/i,
      /optimum\s+nutrition/i,
      /гантел/i,
      /штанга/i,
      /коврик\s+для\s+(?:йог|фитнес)/i,
      /спортивн(?:ая|ое|ый|ые)\s+(?:одежд|костюм|футболк)/i,
      /фитнес/i,
    ],
    profile: {
      weights: {
        brand: 25,
        model: 20,
        series: 15,
        weight: 20,
        volume: 15,
        color: 10,
        title: 20,
        price: 5,
        size: 0,
      },
      required: ['brand'],
      soft: ['size', 'model', 'color'],
      ignore: ['storage', 'gender'],
    },
    stripQueryNoise: (text) =>
      text
        .replace(
          /\b(?:протеин|спорт(?:ив)?(?:ное\s+)?питан(?:ие|ия)|спортивн(?:ая|ое|ый|ые)|фитнес|гантел(?:и|ь)?|штанга)\b/gi,
          ' ',
        )
        .replace(/\s+/g, ' ')
        .trim(),
  },
  {
    id: 'shoes',
    inferPatterns: [
      /кроссовк/i,
      /ботинк/i,
      /туфл/i,
      /сапог/i,
      /\bsneakers?\b/i,
      /\bshoes?\b/i,
      /обувь/i,
      /кеды/i,
      /лоферы/i,
      /мокасин/i,
    ],
    profile: {
      weights: {
        brand: 30,
        model: 30,
        color: 15,
        material: 10,
        title: 25,
        price: 5,
        size: 0,
      },
      required: ['brand'],
      soft: ['size'],
      ignore: ['storage', 'volume', 'packageCount'],
    },
    stripQueryNoise: (text) =>
      text
        .replace(/\b(?:кроссовк(?:и|и)|ботинк(?:и|и)|обувь|кеды|туфл(?:и|и)|sneakers?)\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
  },
  {
    id: 'apparel',
    inferPatterns: [
      /футболк/i,
      /лонгслив/i,
      /худи/i,
      /свитшот/i,
      /куртк/i,
      /джинс/i,
      /платье/i,
      /платья/i,
      /рубашк/i,
      /брюк/i,
      /штаны/i,
      /костюм/i,
      /спортивн(?:ая|ый|ое)\s+костюм/i,
      /леггинс/i,
      /кардиган/i,
      /\bt[- ]?shirt\b/i,
      /\bhoodie\b/i,
      /\bjacket\b/i,
      /одежда/i,
    ],
    profile: {
      weights: {
        brand: 30,
        model: 25,
        color: 25,
        material: 10,
        gender: 10,
        title: 25,
        price: 5,
        size: 0,
      },
      required: ['brand', 'color'],
      soft: ['size', 'gender'],
      ignore: ['storage', 'volume', 'packageCount'],
    },
    stripQueryNoise: (text) =>
      text
        .replace(
          /\b(?:футболк(?:а|и)?|лонгслив|худи|свитшот|куртк(?:а|и)?|платье|рубашк(?:а|и)?|брюк(?:и|и)?|штаны|костюм|одежда|женск(?:ая|ое|ий)|мужск(?:ая|ое|ий))\b/gi,
          ' ',
        )
        .replace(/\s+/g, ' ')
        .trim(),
  },
  {
    id: 'detergents',
    inferPatterns: [
      /порошок/i,
      /гель\s+для\s+стирк/i,
      /средство\s+для\s+(?:стирк|мытья|уборк)/i,
      /ополаскивател/i,
      /кондиционер\s+для\s+бель/i,
      /deterg/i,
      /\bfairy\b/i,
      /\bpersil\b/i,
      /\bariel\b/i,
      /\bdomestos\b/i,
    ],
    profile: {
      weights: {
        brand: 30,
        series: 25,
        model: 15,
        volume: 20,
        packageCount: 15,
        title: 20,
        price: 5,
      },
      required: ['brand', 'packageCount'],
      soft: ['color'],
      ignore: ['storage', 'size'],
    },
  },
  {
    id: 'cosmetics',
    inferPatterns: [
      /шампунь/i,
      /тушь/i,
      /помад/i,
      /тонал/i,
      /сыворотк/i,
      /косметик/i,
      /парфюм/i,
      /духи/i,
      /маск[аи]\s+для\s+(?:лица|волос)/i,
      /крем\s+для\s+(?:лица|рук|тела|ног)/i,
      /\bl(?:'|’)or[eé]al\b/i,
      /loreal/i,
      /\bmaybelline\b/i,
    ],
    profile: {
      weights: {
        brand: 30,
        series: 20,
        model: 15,
        volume: 20,
        color: 15,
        title: 20,
        price: 5,
      },
      required: ['brand'],
      soft: [],
      ignore: ['storage', 'size', 'packageCount'],
    },
    stripQueryNoise: (text) =>
      text
        .replace(/\b(?:шампунь|тушь|помад(?:а|ы)?|тональн(?:ый|ая|ое)?\s+крем|косметик(?:а|и)?|парфюм|духи)\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
  },
  {
    id: 'pet_food',
    roleDefault: 'supply',
    inferPatterns: [
      /корм\s+для/i,
      /сухой\s+корм/i,
      /влажный\s+корм/i,
      /для\s+(?:кош|соб|щен|котят)/i,
      /наполнител/i,
      /кошач(?:ий|ья)\s+туалет/i,
      /\bwet\s+food\b/i,
      /\bdry\s+food\b/i,
      /\bwhiskas\b/i,
      /\broyal\s+canin\b/i,
      /\bpedigree\b/i,
    ],
    profile: {
      weights: {
        brand: 30,
        series: 20,
        model: 10,
        weight: 20,
        packageCount: 10,
        title: 20,
        price: 5,
      },
      required: ['brand', 'packageCount'],
      soft: [],
      ignore: ['storage', 'size', 'color'],
    },
  },
];

const pluginById = new Map<ProductCategory, CategoryPlugin>(
  CATEGORY_PLUGINS.map((p) => [p.id, p]),
);

export function getCategoryPlugin(category: ProductCategory): CategoryPlugin | undefined {
  return pluginById.get(category);
}

export function buildMatchProfiles(): Record<ProductCategory, CategoryMatchProfile> {
  const profiles = { generic: GENERIC_MATCH_PROFILE } as Record<ProductCategory, CategoryMatchProfile>;
  for (const plugin of CATEGORY_PLUGINS) {
    profiles[plugin.id] = plugin.profile;
  }
  return profiles;
}

export function inferCategoryFromPlugins(title: string, specs?: string): ProductCategory {
  const text = `${title} ${specs ?? ''}`.trim();
  if (!text) return 'generic';

  for (const plugin of CATEGORY_PLUGINS) {
    if (plugin.inferPatterns.some((re) => re.test(text))) {
      return plugin.id;
    }
  }

  return 'generic';
}

export function stripQueryNoiseForCategory(category: ProductCategory, text: string): string {
  const strip = getCategoryPlugin(category)?.stripQueryNoise;
  return strip ? strip(text) : text.trim();
}

export function getCategoryMismatchPenalty(
  category: ProductCategory,
  referenceTitle: string,
  candidateTitle: string,
): number {
  const penalty = getCategoryPlugin(category)?.mismatchPenalty;
  return penalty ? penalty(referenceTitle, candidateTitle) : 0;
}

/** Categories with soft model matching (no hard model conflict). */
export const SOFT_MODEL_MATCH_CATEGORIES: ProductCategory[] = [
  'apparel',
  'shoes',
  'home_textile',
  'home_goods',
  'kids',
  'sports',
  'detergents',
  'cosmetics',
  'pet_food',
  'tvs',
  'monitors',
  'accessories',
];
