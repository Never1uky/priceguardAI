/**
 * Извлекает модель товара из длинного названия карточки.
 * Пример: «Смартфон Apple iPhone 13 128GB синий» → «iPhone 13»
 */

import { stripQueryNoiseForCategory, cameraBodyMismatchPenalty as cameraBodyPenalty } from '@/lib/category-plugins';
import {
  buildPrimaryEntityQuery,
  extractEntityFromTitle,
} from '@/lib/entity-extract';
import { isDependentProductRole } from '@/lib/match-rules/types';
import type { ProductCategory } from '@/lib/match-category';
import { parseModelFromSpecsText } from '@/lib/specs-model';

export interface ProductModelInfo {
  /** Короткая модель для поиска */
  model: string;
  brand?: string;
  /** Готовый поисковый запрос */
  searchQuery: string;
}

const BRANDS = [
  'apple',
  'samsung',
  'xiaomi',
  'redmi',
  'poco',
  'huawei',
  'honor',
  'realme',
  'oneplus',
  'google',
  'fujifilm',
  'canon',
  'nikon',
  'sony',
  'lg',
  'asus',
  'lenovo',
  'hp',
  'dell',
  'acer',
  'msi',
  'gigabyte',
  'palit',
  'zotac',
  'nvidia',
  'amd',
  'bosch',
  'makita',
  'metabo',
  'deko',
  'intel',
  'nike',
  'adidas',
  'puma',
  'reebok',
  'persil',
  'ariel',
  'fairy',
  'domestos',
  'jbl',
  'amazfit',
  'roborock',
  'dreame',
  'redmond',
  'polaris',
  'loreal',
  "l'oreal",
  'oral-b',
  'oralb',
  'braun',
  'maybelline',
  'optimum',
  'dyson',
  'nespresso',
];

/** Паттерны моделей (более специфичные — первыми) */
const MODEL_PATTERNS: RegExp[] = [
  // Entity-named accessories before host consoles (PlayStation / PS5)
  /\bdual\s*sense\b/i,
  /\bdualshock\b/i,
  /\biphone\s*(se\s*(?:\d{4}|\(\d{4}\))?|\d{1,2}\s*(?:pro\s*max|pro|plus|mini)?)\b/i,
  /\bgalaxy\s*((?:s|a|m|z|f|note)\s*\d{1,2}(?:\s*(?:ultra|plus|fe|\+))?|z\s*fold\s*\d|z\s*flip\s*\d)\b/i,
  /\bmacbook\s*(?:air|pro)?\s*(?:m[1-4](?:\s*pro)?|\d{4})?\b/i,
  /\bipad\s*(?:pro|air|mini)?\s*\d{1,2}(?:\s*(?:pro|air|mini))?\b/i,
  /\bapple\s*watch\s*(?:series\s*)?\d{1,2}(?:\s*(?:ultra|se))?\b/i,
  // AirPods — от специфичных к общим
  /\bairpods\s*max\b/i,
  /\bairpods\s*pro\s*(?:\d(?:\s*(?:го|го поколения))?|\s*(?:2|3))?\b/i,
  /\bairpods\s*(?:\d|anc)\b/i,
  /\bairpods\b/i,
  // TWS Buds generations (before generic redmi\d phone patterns)
  /\b(?:redmi|xiaomi)\s+buds\s*\d{1,2}(?:\s*(?:pro|live|fe|plus|\+|titan|play|active))?\b/i,
  /\b(?:redmi|xiaomi).{0,40}?\bbuds\s*\d{1,2}(?:\s*(?:pro|live|fe|plus|\+|titan|play|active))?\b/i,
  /\b(?:samsung\s+)?galaxy\s+buds\s*\d{1,2}(?:\s*(?:pro|live|fe|plus|\+|2))?\b/i,
  /\bbuds\s*\d{1,2}(?:\s*(?:pro|live|fe|plus|\+|titan|play|active))?\b/i,
  /\bjbl\s+tune\s*\d{3}\b/i,
  /\bjbl\s+(?:live|wave|quantum)\s*\d{2,3}\b/i,
  /\bwh[-\s]?1000xm\d\b/i,
  /\bamazfit\s+(?:gtr|bip|balance|cheetah|t-rex)\s*\d{1,2}\b/i,
  /\bxiaomi\s+smart\s+band\s*\d{1,2}\b/i,
  /\bmi\s+band\s*\d{1,2}\b/i,
  /\broborock\s+s\d{1,2}(?:\s*pro)?(?:\s*ultra)?\b/i,
  /\bdreame\s+[a-z]?\d{2,4}\b/i,
  /\bredmond\s+rmc[-\s]?[a-z]?\d{3,5}[a-z]?\b/i,
  /\bpolaris\s+[a-z]{2,5}[\s-]?\d{3,5}\b/i,
  /\bsamsung\s+ww\d{2}[a-z]?\d{3,5}[a-z]?\b/i,
  /\boptimum\s+nutrition\s+gold\s+standard\b/i,
  /\bgoogle\s+pixel\s*\d{1,2}[a-z]?(?:\s*(?:pro|a|xl))?\b/i,
  /\bpixel\s*\d{1,2}[a-z]?(?:\s*(?:pro|a|xl))?\b/i,
  /\b(?:redmi|poco|xiaomi)\s*(?:note\s*)?\d{1,2}(?:\s*(?:pro|ultra|\+|t|s|c))?\b/i,
  /\brealme\s*(?:\d{1,2}(?:\s*5g)?(?:\s*pro)?|note\s*\d+)\b/i,
  /\bredmi\s+\d{1,2}\b/i,
  /\bpoco\s*[a-z]\d{1,2}(?:\s*pro)?\b/i,
  /\b(?:geforce\s*)?(?:rtx|gtx)\s*\d{3,4}(?:\s*(?:ti|super|xt))?\b/i,
  /\b(?:radeon\s*)?rx\s*\d{3,4}(?:\s*xt)?\b/i,
  /\b(?:core\s*)?i[3579]-?\d{4,5}[a-z]{0,3}\b/i,
  /\bryzen\s*\d{1,2}\s*\d{4}[a-z]{0,3}\b/i,
  /\bplaystation\s*\d\b/i,
  /\binstax\s*mini\s*\d{1,2}\b/i,
  /\binstax\s*(?:mini|wide|square)\b/i,
  /\bxbox\s*series\s*[xs]\b/i,
  /\bnintendo\s*switch(?:\s*(?:oled|lite))?\b/i,
  /\bcanon\s+eos\s*\d{3,4}\s*d?\b/i,
  /\beos\s*\d{3,4}\s*d\b/i,
  /\bcanon\s+\d{3,4}\s*d\b/i,
  /\bnikon\s+d\d{3,4}\b/i,
  /\bsony\s+(?:alpha|α)\s*\d{1,2}\b/i,
  /\bfujifilm\s+x-?[st]\d{1,2}\b/i,
  /\b(?:ef|rf)\s*-?\s*\d{1,3}\s*mm\s*f\/?[\d.]+/i,
  /\b\d{1,3}\s*mm\s*f\/?[\d.]+\b/i,
  /\bplaystation\s*[45]\b/i,
  /\bps\s*[45]\b/i,
  /\bxbox\s+series\s*[xs]\b/i,
  /\bsteam\s+deck\b/i,
  /\b(?:bosch|makita|metabo|deko|интерскол)\s+[a-z]{2,5}[\s-]?\d{3,5}[a-z]?\b/i,
  /\bgsb\s*\d{3,4}\b/i,
  /\b[a-z]{1,4}-[a-z]?\d{3,6}[a-z0-9]*(?:\s*[a-z]-?\d{1,3}[a-z]{1,3})?\b/i,
];

function normalizeSpaces(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function detectBrand(title: string): string | undefined {
  const lower = title.toLowerCase();
  return BRANDS.find((b) => lower.includes(b));
}

/** Экосистемы брендов: Xiaomi = Redmi = Poco */
const BRAND_FAMILIES: Record<string, string> = {
  xiaomi: 'xiaomi',
  redmi: 'xiaomi',
  poco: 'xiaomi',
  huawei: 'huawei',
  honor: 'honor',
};

/** Совместимы ли бренды в названиях (для кросс-площадочного сравнения) */
export function areBrandsCompatible(referenceTitle: string, candidateTitle: string): boolean {
  const refBrand = detectBrand(referenceTitle);
  const candBrand = detectBrand(candidateTitle);
  if (!refBrand || !candBrand) return true;

  const refFamily = BRAND_FAMILIES[refBrand] ?? refBrand;
  const candFamily = BRAND_FAMILIES[candBrand] ?? candBrand;
  return refFamily === candFamily;
}

export function detectProductBrand(title: string): string | undefined {
  return detectBrand(title);
}

function extractByPatterns(title: string): string | null {
  for (const pattern of MODEL_PATTERNS) {
    const match = title.match(pattern);
    if (match) return normalizeSpaces(match[0]);
  }
  return null;
}

function trimNoiseWords(title: string): string {
  return title
    .replace(
      /\b(смартфон|телефон|ноутбук|видеокарта|наушники|планшет|фотоаппарат|чехол|зарядка|кабель|чёрный|белый|синий|128|256|512|1024)\b/gi,
      '',
    )
    .replace(/\s+/g, ' ')
    .trim();
}

/** Убрать kit-объектив из поискового запроса камер. */
export { stripCameraKitNoise } from '@/lib/category-plugins';

/** Category-specific query cleanup before cross-marketplace SERP. */
export function stripCategoryQueryNoise(category: ProductCategory, text: string): string {
  return stripQueryNoiseForCategory(category, text);
}

/** Штраф за разные body-модели камер (650D ≠ 600D). Re-export from category registry. */
export function cameraBodyMismatchPenalty(referenceTitle: string, candidateTitle: string): number {
  return cameraBodyPenalty(referenceTitle, candidateTitle);
}

export function extractProductModel(title: string): ProductModelInfo {
  const cleaned = title.trim();
  if (!cleaned || cleaned === 'Товар') {
    return { model: '', searchQuery: '' };
  }

  const brand = detectBrand(cleaned);

  // Dependent SKUs: model/query from primary entity, not compatibility host
  const entity = extractEntityFromTitle(cleaned);
  if (isDependentProductRole(entity.productRole) && entity.primaryEntity.length >= 3) {
    const lead = buildPrimaryEntityQuery(entity);
    return {
      model: entity.primaryEntity.slice(0, 80),
      brand: entity.brand ?? brand,
      searchQuery: (lead || entity.primaryEntity).slice(0, 80),
    };
  }

  const fromPattern = extractByPatterns(cleaned);

  if (fromPattern) {
    const searchQuery =
      brand && !fromPattern.toLowerCase().includes(brand)
        ? normalizeSpaces(`${brand} ${fromPattern}`)
        : fromPattern;

    return {
      model: fromPattern,
      brand,
      searchQuery: searchQuery.slice(0, 80),
    };
  }

  const words = trimNoiseWords(cleaned)
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .slice(0, 6);

  const model = words.join(' ');
  return {
    model,
    brand,
    searchQuery: model.slice(0, 80),
  };
}

/** Модель из характеристик → приоритетнее заголовка */
export function inferProductModel(
  title: string,
  specsOrModelField?: string,
): ProductModelInfo {
  // Only structured model lines from specs — never the whole kit dump
  // (e.g. «В комплекте DualSense» must not become the console's searchQuery).
  const fromSpecs = specsOrModelField ? parseModelFromSpecsText(specsOrModelField) : null;
  const titleInfo = extractProductModel(title);

  if (fromSpecs && fromSpecs.length >= 3) {
    const specsInfo = extractProductModel(fromSpecs);
    if (specsInfo.model.length >= 3) {
      // Specs often say «Google Pixel» without generation; title has «Pixel 7»
      if (titleModelHasRicherGeneration(titleInfo.model, specsInfo.model)) {
        return titleInfo;
      }
      return specsInfo;
    }
  }

  return titleInfo;
}

/** Title model wins when it carries a generation digit the specs model lost. */
function titleModelHasRicherGeneration(titleModel: string, specsModel: string): boolean {
  const t = titleModel.toLowerCase();
  const s = specsModel.toLowerCase();
  if (/\bpixel\s*\d/i.test(t) && !/\bpixel\s*\d/i.test(s)) return true;
  if (/\biphone\s*\d/i.test(t) && !/\biphone\s*\d/i.test(s)) return true;
  if (/\bredmi(?:\s*note)?\s*\d/i.test(t) && !/\bredmi(?:\s*note)?\s*\d/i.test(s)) return true;
  return false;
}

/** Память/объём для поиска: «8+256», «128 ГБ», «256gb» */
export function extractStorageSpecQuery(title: string, specs?: string): string | undefined {
  const normalized = normalizeStorageKey(extractStorageKey(title, specs));
  return normalized ?? undefined;
}

export interface ProductVariantAttributes {
  storage?: string;
  color?: string;
}

const COLOR_ALIASES: Record<string, string> = {
  черный: 'black',
  чёрный: 'black',
  black: 'black',
  midnight: 'black',
  graphite: 'black',
  obsidian: 'black',
  белый: 'white',
  white: 'white',
  starlight: 'white',
  porcelain: 'white',
  синий: 'blue',
  blue: 'blue',
  серебристый: 'silver',
  silver: 'silver',
  серый: 'gray',
  grey: 'gray',
  gray: 'gray',
  зеленый: 'green',
  зелёный: 'green',
  green: 'green',
  красный: 'red',
  red: 'red',
  золотой: 'gold',
  gold: 'gold',
  фиолетовый: 'purple',
  purple: 'purple',
  indigo: 'purple',
  розовый: 'pink',
  pink: 'pink',
  желтый: 'yellow',
  жёлтый: 'yellow',
  'светло-желтый': 'yellow',
  'светло-жёлтый': 'yellow',
  lemongrass: 'yellow',
  yellow: 'yellow',
  beige: 'beige',
  бежевый: 'beige',
  hazel: 'beige',
};

const COLOR_PATTERN =
  /\b(ч[её]рн(?:ый|ая|ое)?|бел(?:ый|ая|ое)?|син(?:ий|яя|ее)?|серебрист(?:ый|ая|ое)?|сер(?:ый|ая|ое)?|зел[её]н(?:ый|ая|ое)?|красн(?:ый|ая|ое)?|золот(?:ой|ая|ое)?|фиолетов(?:ый|ая|ое)?|розов(?:ый|ая|ое)?|светло-?ж[её]лт\w*|ж[её]лт(?:ый|ая|ое)?|obsidian|porcelain|indigo|hazel|midnight|graphite|starlight|lemongrass|black|white|blue|silver|grey|gray|green|red|gold|purple|pink|yellow|beige)\b/i;

function normalizeColorKey(raw: string): string {
  const lower = raw.toLowerCase().trim();
  return COLOR_ALIASES[lower] ?? lower;
}

function extractStorageKey(title: string, specs?: string): string | undefined {
  const combined = `${title} ${specs ?? ''}`;

  // 24+1 ТБ / 16+512GB / 16 ГБ / 1 ТБ
  // Не используем \b после кириллицы (в JS \b — только ASCII word chars)
  const plusTb = combined.match(/(\d{1,2})\s*\+\s*(\d(?:[.,]\d)?)\s*(?:тб|tb)(?![a-zа-яё])/i);
  if (plusTb) {
    const tb = Math.round(parseFloat(plusTb[2].replace(',', '.')) * 1024);
    return `${plusTb[1]}+${tb}`;
  }

  const cyrSlash = combined.match(/(\d{1,2})\s*(?:gb|гб)\s*\/\s*(\d{2,4})\s*(?:gb|гб)/i);
  if (cyrSlash) return `${cyrSlash[1]}+${cyrSlash[2]}`;

  const plusMem = combined.match(/\b(\d{1,2})\s*\+\s*(\d{2,4})\b/i);
  if (plusMem) return `${plusMem[1]}+${plusMem[2]}`;

  const slashMem = combined.match(/\b(\d{1,2})\s*\/\s*(\d{2,4})\s*(?:gb|гб|гб\.?)?\b/i);
  if (slashMem) return `${slashMem[1]}+${slashMem[2]}`;

  const ramRom = combined.match(/\b(\d{1,2})\s*(?:gb|гб)\s*\+\s*(\d{2,4})\s*(?:gb|гб)\b/i);
  if (ramRom) return `${ramRom[1]}+${ramRom[2]}`;

  const tbOnly = combined.match(/(\d(?:[.,]\d)?)\s*(?:тб|tb)(?![a-zа-яё])/i);
  if (tbOnly) {
    const tb = Math.round(parseFloat(tbOnly[1].replace(',', '.')) * 1024);
    return `${tb}gb`;
  }

  const gbOnly = combined.match(/\b(\d{2,4})\s*(?:gb|гб)\b/i);
  if (gbOnly) return `${gbOnly[1]}gb`;

  return undefined;
}

/** Читаемый фрагмент памяти для поискового запроса: «8 256» — never a bare «ГБ». */
export function formatStorageForSearch(storageKey: string | undefined): string | undefined {
  if (!storageKey || !/\d/.test(storageKey)) return undefined;
  const plus = storageKey.match(/^(\d{1,2})\+(\d{2,4})$/);
  if (plus) return `${plus[1]} ${plus[2]}`;
  const gb = storageKey.match(/^(\d{2,4})gb$/);
  if (gb) return gb[1];
  return storageKey;
}

function normalizeStorageKey(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const lower = raw.toLowerCase().replace(/\s+/g, '');
  const plus = lower.match(/^(\d{1,2})\+(\d{2,4})$/);
  if (plus) return `${plus[1]}+${plus[2]}`;
  const slash = lower.match(/^(\d{1,2})\/(\d{2,4})$/);
  if (slash) return `${slash[1]}+${slash[2]}`;
  const gb = lower.match(/^(\d{2,4})gb$/);
  if (gb) return `${gb[1]}gb`;
  if (!/\d/.test(lower)) return undefined;
  return lower;
}

export function extractColorSpecQuery(title: string, specs?: string): string | undefined {
  const combined = `${title} ${specs ?? ''}`.toLowerCase();
  const match = combined.match(COLOR_PATTERN);
  if (match) return match[1];

  for (const [alias, canonical] of Object.entries(COLOR_ALIASES)) {
    if (combined.includes(alias)) return canonical;
  }

  return undefined;
}

/** Память и цвет из названия/характеристик */
export function extractVariantAttributes(title: string, specs?: string): ProductVariantAttributes {
  const storage = normalizeStorageKey(extractStorageKey(title, specs));
  const colorRaw = extractColorSpecQuery(title, specs);
  const color = colorRaw ? normalizeColorKey(colorRaw) : undefined;
  return { storage, color };
}

/** Штраф 0–1 за несовпадение памяти/цвета (для ранжирования) */
export function variantMismatchPenalty(
  referenceTitle: string,
  candidateTitle: string,
  referenceSpecs?: string,
): number {
  const ref = extractVariantAttributes(referenceTitle, referenceSpecs);
  const cand = extractVariantAttributes(candidateTitle);

  let penalty = 0;

  if (ref.storage && cand.storage && ref.storage !== cand.storage) {
    penalty += 0.55;
  }

  if (ref.color && cand.color && ref.color !== cand.color) {
    penalty += 0.3;
  }

  return Math.min(penalty, 0.75);
}

/** Запрос: модель + память + цвет */
export function buildVariantSearchQuery(title: string, specs?: string): string {
  const info = inferProductModel(title, specs);
  const parts: string[] = [];

  if (info.searchQuery.length >= 3) parts.push(info.searchQuery);
  const storage = formatStorageForSearch(extractStorageSpecQuery(title, specs));
  if (storage) parts.push(storage);

  const query = parts.join(' ').trim();
  if (query.length >= 4) return query.slice(0, 100);
  return buildModelSearchQuery(title, undefined, specs);
}

export function buildModelSearchQuery(
  title: string,
  article?: string,
  specsOrModel?: string,
): string {
  const info = inferProductModel(title, specsOrModel);
  if (info.searchQuery.length >= 4) return info.searchQuery;
  if (article?.trim()) return article.trim();
  return title.slice(0, 120);
}
