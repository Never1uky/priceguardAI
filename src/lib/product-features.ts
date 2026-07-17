/**
 * Структурированные признаки товара для матчинга между площадками.
 * Сравниваем features, а не «сырое» название.
 */

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
}

/** Веса feature-matching (сумма 100) */
export const FEATURE_WEIGHTS = {
  brand: 40,
  model: 35,
  storage: 15,
  color: 5,
  price: 5,
} as const;

export function extractProductFeatures(title: string, specs?: string): ProductFeatures {
  const info = extractProductModel(title);
  const variant = extractVariantAttributes(title, specs);
  return {
    brand: info.brand,
    model: info.model || undefined,
    storage: variant.storage,
    color: variant.color,
    title,
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

/**
 * Баллы 0–100 по структурированным признакам.
 * priceScore 0|1 — совместимость цены (передаётся снаружи).
 */
export function scoreFeatureMatch(
  reference: ProductFeatures,
  candidate: ProductFeatures,
  priceCompatible = true,
): { score: number; breakdown: Record<string, number> } {
  const breakdown: Record<string, number> = {
    brand: 0,
    model: 0,
    storage: 0,
    color: 0,
    price: 0,
  };

  // Brand
  const refBrand = brandFamily(reference.brand);
  const candBrand = brandFamily(candidate.brand);
  if (refBrand && candBrand) {
    if (refBrand === candBrand) {
      breakdown.brand = FEATURE_WEIGHTS.brand;
    } else if (areBrandsCompatible(reference.title, candidate.title)) {
      breakdown.brand = FEATURE_WEIGHTS.brand * 0.5;
    }
  } else if (!refBrand && !candBrand) {
    breakdown.brand = FEATURE_WEIGHTS.brand * 0.25;
  }

  // Model
  const refModel = norm(reference.model);
  const candModel = norm(candidate.model);
  if (refModel && candModel) {
    if (refModel === candModel) {
      breakdown.model = FEATURE_WEIGHTS.model;
    } else if (refModel.includes(candModel) || candModel.includes(refModel)) {
      const ratio = Math.min(refModel.length, candModel.length) / Math.max(refModel.length, candModel.length);
      breakdown.model = ratio >= 0.7 ? FEATURE_WEIGHTS.model * 0.7 : FEATURE_WEIGHTS.model * 0.25;
    }
  } else if (!refModel && !candModel) {
    breakdown.model = FEATURE_WEIGHTS.model * 0.15;
  }

  // Storage — жёстко: разный объём почти дисквалифицирует
  if (reference.storage && candidate.storage) {
    if (reference.storage === candidate.storage) {
      breakdown.storage = FEATURE_WEIGHTS.storage;
    } else {
      breakdown.storage = 0;
    }
  } else {
    breakdown.storage = FEATURE_WEIGHTS.storage * 0.4;
  }

  // Color
  if (reference.color && candidate.color) {
    breakdown.color =
      reference.color === candidate.color ? FEATURE_WEIGHTS.color : 0;
  } else {
    breakdown.color = FEATURE_WEIGHTS.color * 0.5;
  }

  // Price band
  breakdown.price = priceCompatible ? FEATURE_WEIGHTS.price : 0;

  // Жёсткий ноль при явном конфликте бренда
  if (refBrand && candBrand && refBrand !== candBrand && !areBrandsCompatible(reference.title, candidate.title)) {
    return { score: Math.min(8, breakdown.brand + breakdown.model), breakdown };
  }

  // Жёсткий штраф при разной памяти, когда обе известны
  if (reference.storage && candidate.storage && reference.storage !== candidate.storage) {
    const soft = breakdown.brand + breakdown.model * 0.3 + breakdown.color + breakdown.price;
    return { score: Math.min(soft, 42), breakdown };
  }

  const score = Object.values(breakdown).reduce((a, b) => a + b, 0);
  return { score: Math.round(Math.min(100, score)), breakdown };
}

/** Поисковая строка из features: brand + model + storage + color */
export function buildFeatureSearchQuery(features: ProductFeatures): string {
  const parts: string[] = [];
  if (features.brand) parts.push(features.brand);
  if (features.model) parts.push(features.model);
  if (features.storage) {
    const plus = features.storage.match(/^(\d+)\+(\d+)$/);
    if (plus) parts.push(`${plus[1]} ${plus[2]}`);
    else if (features.storage.endsWith('gb')) parts.push(features.storage.replace('gb', ' GB'));
    else parts.push(features.storage);
  }
  if (features.color) parts.push(features.color);
  const q = parts.join(' ').trim();
  return q.slice(0, 100);
}
