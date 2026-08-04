/**
 * Структурированные признаки товара для матчинга между площадками.
 * Сравниваем features + category profile, а не «сырое» название.
 */

import {
  extractNormalizedColor,
  extractNormalizedMaterial,
  extractNormalizedPackageCount,
  extractNormalizedSize,
  extractNormalizedStorage,
  extractNormalizedVolumeMl,
  extractNormalizedWeightG,
  normalizeColor,
  normalizeStorage,
} from '@/lib/attr-normalize';
import {
  getMatchProfile,
  inferProductCategory,
  shouldPenalizeStorageMismatch,
  type MatchFeatureKey,
  type ProductCategory,
} from '@/lib/match-category';
import {
  areBrandsCompatible,
  extractProductModel,
  extractVariantAttributes,
} from '@/lib/model-extract';

export interface ProductFeatures {
  brand?: string;
  model?: string;
  /** Нормализованный ключ памяти: «8+256», «512gb» */
  storage?: string;
  color?: string;
  /** Сырой title для fallback */
  title: string;
  category?: ProductCategory;
  volumeMl?: number;
  weightG?: number;
  packageCount?: number;
  size?: string;
  series?: string;
  gender?: string;
  material?: string;
  mpn?: string;
}

/** Legacy default weights (generic / electronics-lite). Sum ≈ 100 */
export const FEATURE_WEIGHTS = {
  brand: 40,
  model: 35,
  storage: 15,
  color: 5,
  price: 5,
} as const;

function extractSeries(title: string, specs?: string): string | undefined {
  const combined = `${title} ${specs ?? ''}`;
  const m =
    combined.match(/(?:серия|линейка|series)\s*[:\-]?\s*([A-Za-zА-Яа-яЁё0-9][\wА-Яа-яЁё\- ]{1,40})/i) ??
    combined.match(/\b((?:Persil|Ariel|Fairy|Domestos|Whiskas|Royal Canin|L(?:'|')?Or[eé]al|Maybelline|JBL|Roborock|Redmond)[\w\-]*)\b/i);
  return m?.[1]?.trim().slice(0, 40);
}

function extractGender(title: string, specs?: string): string | undefined {
  const t = `${title} ${specs ?? ''}`.toLowerCase();
  if (/мужск|для\s+муж|men'?s?\b|male\b/.test(t)) return 'male';
  if (/женск|для\s+жен|women'?s?\b|female\b|lady\b/.test(t)) return 'female';
  if (/унисекс|unisex/.test(t)) return 'unisex';
  if (/детск|для\s+дет|kids?\b|child/.test(t)) return 'kids';
  return undefined;
}

function extractMpn(title: string, specs?: string): string | undefined {
  const combined = `${title} ${specs ?? ''}`;
  const m =
    combined.match(/(?:артикул|mpn|p\/n|part\s*number)\s*[:\-]?\s*([A-Z0-9][\w\-]{3,24})/i) ??
    combined.match(/\b([A-Z]{2,}\d{3,}[A-Z0-9\-]*)\b/);
  return m?.[1]?.trim();
}

export function extractProductFeatures(title: string, specs?: string): ProductFeatures {
  const info = extractProductModel(title);
  const variant = extractVariantAttributes(title, specs);
  const category = inferProductCategory(title, specs);

  const storage =
    normalizeStorage(variant.storage) ??
    extractNormalizedStorage(title, specs) ??
    variant.storage;
  const color =
    normalizeColor(variant.color) ??
    extractNormalizedColor(title, specs) ??
    variant.color;

  return {
    brand: info.brand,
    model: info.model || undefined,
    storage,
    color: color ? String(color) : undefined,
    title,
    category,
    volumeMl: extractNormalizedVolumeMl(title, specs),
    weightG: extractNormalizedWeightG(title, specs),
    packageCount: extractNormalizedPackageCount(title, specs),
    size: extractNormalizedSize(title, specs),
    series: extractSeries(title, specs),
    gender: extractGender(title, specs),
    material: extractNormalizedMaterial(title, specs),
    mpn: extractMpn(title, specs),
  };
}

function norm(s: string | undefined): string {
  return (s ?? '').toLowerCase().replace(/\s+/g, '').replace(/[()]/g, '');
}

function brandFamily(brand: string | undefined): string | undefined {
  if (!brand) return undefined;
  const b = brand.toLowerCase();
  if (b === 'redmi' || b === 'poco' || b === 'xiaomi') return 'xiaomi';
  return b;
}

function featurePresent(
  features: ProductFeatures,
  key: MatchFeatureKey,
): boolean {
  switch (key) {
    case 'brand':
      return Boolean(features.brand);
    case 'model':
      return Boolean(features.model);
    case 'storage':
      return Boolean(features.storage);
    case 'color':
      return Boolean(features.color);
    case 'volume':
      return features.volumeMl != null;
    case 'weight':
      return features.weightG != null;
    case 'packageCount':
      return features.packageCount != null;
    case 'size':
      return Boolean(features.size);
    case 'series':
      return Boolean(features.series);
    case 'gender':
      return Boolean(features.gender);
    case 'material':
      return Boolean(features.material);
    case 'title':
      return Boolean(features.title);
    case 'price':
      return true;
    default:
      return false;
  }
}

function featureEqual(
  reference: ProductFeatures,
  candidate: ProductFeatures,
  key: MatchFeatureKey,
): boolean | 'unknown' {
  switch (key) {
    case 'brand': {
      const a = brandFamily(reference.brand);
      const b = brandFamily(candidate.brand);
      if (!a || !b) return 'unknown';
      if (a === b) return true;
      return areBrandsCompatible(reference.title, candidate.title);
    }
    case 'model': {
      const a = norm(reference.model);
      const b = norm(candidate.model);
      if (!a || !b) return 'unknown';
      if (a === b) return true;
      if (a.includes(b) || b.includes(a)) {
        const ratio = Math.min(a.length, b.length) / Math.max(a.length, b.length);
        return ratio >= 0.7;
      }
      return false;
    }
    case 'storage': {
      if (!reference.storage || !candidate.storage) return 'unknown';
      return reference.storage === candidate.storage;
    }
    case 'color': {
      if (!reference.color || !candidate.color) return 'unknown';
      return reference.color === candidate.color;
    }
    case 'volume': {
      if (reference.volumeMl == null || candidate.volumeMl == null) return 'unknown';
      const lo = Math.min(reference.volumeMl, candidate.volumeMl);
      const hi = Math.max(reference.volumeMl, candidate.volumeMl);
      return hi <= lo * 1.05;
    }
    case 'weight': {
      if (reference.weightG == null || candidate.weightG == null) return 'unknown';
      const lo = Math.min(reference.weightG, candidate.weightG);
      const hi = Math.max(reference.weightG, candidate.weightG);
      return hi <= lo * 1.08;
    }
    case 'packageCount': {
      if (reference.packageCount == null || candidate.packageCount == null) return 'unknown';
      return reference.packageCount === candidate.packageCount;
    }
    case 'size': {
      if (!reference.size || !candidate.size) return 'unknown';
      return reference.size === candidate.size;
    }
    case 'series': {
      const a = norm(reference.series);
      const b = norm(candidate.series);
      if (!a || !b) return 'unknown';
      return a === b || a.includes(b) || b.includes(a);
    }
    case 'gender': {
      if (!reference.gender || !candidate.gender) return 'unknown';
      if (reference.gender === 'unisex' || candidate.gender === 'unisex') return true;
      return reference.gender === candidate.gender;
    }
    case 'material': {
      if (!reference.material || !candidate.material) return 'unknown';
      return reference.material === candidate.material;
    }
    case 'title':
    case 'price':
      return 'unknown';
    default:
      return 'unknown';
  }
}

function modelPartialRatio(reference: ProductFeatures, candidate: ProductFeatures): number {
  const a = norm(reference.model);
  const b = norm(candidate.model);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) {
    return Math.min(a.length, b.length) / Math.max(a.length, b.length);
  }
  return 0;
}

/**
 * Баллы 0–100 по структурированным признакам и категорийному профилю.
 * Отсутствующие признаки не штрафуют как mismatch (вес перенормируется).
 */
export function scoreFeatureMatch(
  reference: ProductFeatures,
  candidate: ProductFeatures,
  priceCompatible = true,
): { score: number; breakdown: Record<string, number>; category: ProductCategory } {
  const category =
    reference.category ??
    candidate.category ??
    inferProductCategory(reference.title);

  const profile = getMatchProfile(category);
  const breakdown: Record<string, number> = {};

  const refBrand = brandFamily(reference.brand);
  const candBrand = brandFamily(candidate.brand);

  // Hard brand conflict
  if (
    refBrand &&
    candBrand &&
    refBrand !== candBrand &&
    !areBrandsCompatible(reference.title, candidate.title)
  ) {
    return {
      score: 8,
      breakdown: { brand: 0 },
      category,
    };
  }

  // Required conflicts (both present, disagree, not soft)
  for (const key of profile.required) {
    if (profile.soft.includes(key) || profile.ignore.includes(key)) continue;
    if (!featurePresent(reference, key) || !featurePresent(candidate, key)) continue;
    const eq = featureEqual(reference, candidate, key);
    if (eq === false) {
      // Storage required conflict → soft cap like legacy phones
      if (key === 'storage' && shouldPenalizeStorageMismatch(category)) {
        breakdown.brand = (profile.weights.brand ?? 30) * (refBrand === candBrand ? 1 : 0.5);
        breakdown.model = (profile.weights.model ?? 20) * modelPartialRatio(reference, candidate) * 0.3;
        const soft = Object.values(breakdown).reduce((a, b) => a + b, 0);
        return { score: Math.min(Math.round(soft), 42), breakdown, category };
      }
      if (key === 'brand' || key === 'model') {
        return {
          score: Math.min(35, Math.round((profile.weights.brand ?? 20) * 0.4)),
          breakdown: { [key]: 0 },
          category,
        };
      }
    }
  }

  // Storage hard penalty for electronics even if not in required
  if (
    shouldPenalizeStorageMismatch(category) &&
    reference.storage &&
    candidate.storage &&
    reference.storage !== candidate.storage
  ) {
    breakdown.brand = (profile.weights.brand ?? 30) * (refBrand && candBrand && refBrand === candBrand ? 1 : 0.5);
    breakdown.model = (profile.weights.model ?? 20) * modelPartialRatio(reference, candidate) * 0.3;
    breakdown.color =
      reference.color && candidate.color && reference.color === candidate.color
        ? (profile.weights.color ?? 5)
        : 0;
    breakdown.price = priceCompatible ? (profile.weights.price ?? 5) : 0;
    const soft = Object.values(breakdown).reduce((a, b) => a + b, 0);
    return { score: Math.min(Math.round(soft), 42), breakdown, category };
  }

  // Active weights: present on at least one side (or always-on price/title handled separately)
  const scoreKeys = (Object.keys(profile.weights) as MatchFeatureKey[]).filter((key) => {
    if (profile.ignore.includes(key)) return false;
    if (key === 'size' && profile.soft.includes('size')) return false; // never contribute
    if (key === 'title') return false; // title handled in scoreProductMatch
    if (key === 'price') return true;
    return featurePresent(reference, key) || featurePresent(candidate, key);
  });

  let weightSum = 0;
  for (const key of scoreKeys) {
    weightSum += profile.weights[key] ?? 0;
  }
  if (weightSum <= 0) weightSum = 100;

  for (const key of scoreKeys) {
    const w = profile.weights[key] ?? 0;
    const scaled = (w / weightSum) * 100;

    if (key === 'price') {
      breakdown.price = priceCompatible ? scaled : 0;
      continue;
    }

    if (profile.soft.includes(key)) {
      // Soft: match adds points; mismatch / unknown → neutral partial credit
      const eq = featureEqual(reference, candidate, key);
      if (eq === true) breakdown[key] = scaled;
      else if (eq === 'unknown') breakdown[key] = scaled * 0.5;
      else breakdown[key] = scaled * 0.45; // mismatch soft — almost neutral
      continue;
    }

    const eq = featureEqual(reference, candidate, key);
    if (eq === true) {
      if (key === 'model') {
        const ratio = modelPartialRatio(reference, candidate);
        breakdown.model = ratio >= 0.99 ? scaled : scaled * Math.max(0.7, ratio);
      } else if (key === 'brand') {
        breakdown.brand =
          refBrand && candBrand && refBrand === candBrand
            ? scaled
            : scaled * 0.5;
      } else {
        breakdown[key] = scaled;
      }
    } else if (eq === 'unknown') {
      // Missing on one side — partial credit (don't punish)
      if (key === 'brand' && !refBrand && !candBrand) breakdown.brand = scaled * 0.25;
      else if (key === 'model' && !reference.model && !candidate.model) breakdown.model = scaled * 0.15;
      else breakdown[key] = scaled * 0.4;
    } else {
      breakdown[key] = 0;
    }
  }

  const score = Object.values(breakdown).reduce((a, b) => a + b, 0);
  return { score: Math.round(Math.min(100, score)), breakdown, category };
}

/** Поисковая строка из features: brand + model + storage + color */
export function buildFeatureSearchQuery(features: ProductFeatures): string {
  const parts: string[] = [];
  if (features.brand) parts.push(features.brand);
  if (features.model) parts.push(features.model);
  if (features.series) parts.push(features.series);
  if (features.storage) {
    const plus = features.storage.match(/^(\d+)\+(\d+)$/);
    if (plus) parts.push(`${plus[1]} ${plus[2]}`);
    else if (features.storage.endsWith('gb')) parts.push(features.storage.replace('gb', ' GB'));
    else parts.push(features.storage);
  }
  if (features.volumeMl) {
    parts.push(features.volumeMl >= 1000 ? `${features.volumeMl / 1000} л` : `${features.volumeMl} мл`);
  }
  if (features.color) parts.push(features.color);
  const q = parts.join(' ').trim();
  return q.slice(0, 100);
}
