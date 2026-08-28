/**
 * Category inference + match weight profiles for cross-marketplace scoring.
 * Adding a category = extend CATEGORY_PLUGINS in category-plugins.ts (+ MODEL_PATTERNS if needed).
 *
 * --- How to add a new category (extend-only) ---
 * 1. Add id to ProductCategory union below.
 * 2. Add one entry to CATEGORY_PLUGINS (inferPatterns, profile, optional stripQueryNoise / mismatchPenalty).
 * 3. model-extract.ts: MODEL_PATTERNS if model extract needs new patterns.
 * 4. Tests: infer + score same-model vs wrong-variant; regression on smartphones/laptops.
 */

import {
  buildMatchProfiles,
  inferCategoryFromPlugins,
  areCategoriesIncompatible as areCategoriesIncompatibleImpl,
  shouldRejectAccessoryVsPrimaryDevice,
} from '@/lib/category-plugins';
import { areEntityRolesIncompatible } from '@/lib/entity-extract';

export {
  CATEGORY_PLUGINS,
  GENERIC_MATCH_PROFILE,
  SOFT_MODEL_MATCH_CATEGORIES,
  areCategoriesIncompatible,
  cameraBodyMismatchPenalty,
  getCategoryMismatchPenalty,
  getCategoryPlugin,
  hasAccessorySkuMarker,
  shouldRejectAccessoryVsPrimaryDevice,
  stripQueryNoiseForCategory,
  type CategoryPlugin,
} from '@/lib/category-plugins';

export type ProductCategory =
  | 'smartphones'
  | 'laptops'
  | 'gpus'
  | 'desktops'
  | 'monoblocks'
  | 'pc_components'
  | 'tvs'
  | 'monitors'
  | 'accessories'
  | 'headphones'
  | 'wearables'
  | 'lenses'
  | 'cameras'
  | 'consoles'
  | 'networking'
  | 'power_tools'
  | 'appliances'
  | 'home_textile'
  | 'home_goods'
  | 'kids'
  | 'sports'
  | 'apparel'
  | 'shoes'
  | 'detergents'
  | 'cosmetics'
  | 'pet_food'
  | 'grocery'
  | 'memory_cards'
  | 'generic';

/** Features that can carry weight in a profile */
export type MatchFeatureKey =
  | 'brand'
  | 'model'
  | 'storage'
  | 'color'
  | 'volume'
  | 'weight'
  | 'packageCount'
  | 'size'
  | 'series'
  | 'gender'
  | 'material'
  | 'condition'
  | 'authenticity'
  | 'region'
  | 'edition'
  | 'connector'
  | 'title'
  | 'price';

export interface CategoryMatchProfile {
  /**
   * Relative weights (renormalized over present attrs at score time).
   * Contract: hard identity (required / lineage) first → soft attrs → price only as tie-break
   * among hard-compatible candidates (see computeCandidatePriority / pickSearchFromCandidates).
   */
  weights: Partial<Record<MatchFeatureKey, number>>;
  /** Both sides present + disagree → hard conflict (low score) */
  required: MatchFeatureKey[];
  /** Mismatch is soft / ignored for same-product listing match */
  soft: MatchFeatureKey[];
  /** Never score */
  ignore: MatchFeatureKey[];
}

export const MATCH_PROFILES: Record<ProductCategory, CategoryMatchProfile> = buildMatchProfiles();

/** Infer product category from title + optional specs (no LLM). */
export function inferProductCategory(title: string, specs?: string): ProductCategory {
  return inferCategoryFromPlugins(title, specs);
}

/** Reference category A must not match candidate category B (non-generic mismatch). */
export function isTitleCategoryCompatible(
  referenceTitle: string,
  candidateTitle: string,
  referenceSpecs?: string,
): boolean {
  const a = inferProductCategory(referenceTitle, referenceSpecs);
  const b = inferProductCategory(candidateTitle);
  if (areCategoriesIncompatibleImpl(a, b)) return false;
  if (shouldRejectAccessoryVsPrimaryDevice(referenceTitle, candidateTitle, a)) {
    return false;
  }
  if (areEntityRolesIncompatible(referenceTitle, candidateTitle, referenceSpecs)) {
    return false;
  }
  return true;
}

export function getMatchProfile(category: ProductCategory): CategoryMatchProfile {
  return MATCH_PROFILES[category] ?? MATCH_PROFILES.generic;
}

export function isSoftFeature(category: ProductCategory, key: MatchFeatureKey): boolean {
  const profile = getMatchProfile(category);
  return profile.soft.includes(key) || profile.ignore.includes(key);
}

/** Size mismatch must not fail apparel/shoes/home textile/kids/sports listing match. */
export function shouldIgnoreSizeMismatch(category: ProductCategory): boolean {
  return (
    category === 'apparel' ||
    category === 'shoes' ||
    category === 'home_textile' ||
    category === 'kids' ||
    category === 'sports' ||
    isSoftFeature(category, 'size')
  );
}

const NO_STORAGE_PENALTY_CATEGORIES: ProductCategory[] = [
  'apparel',
  'shoes',
  'home_textile',
  'home_goods',
  'kids',
  'sports',
  'detergents',
  'cosmetics',
  'pet_food',
  'grocery',
  'headphones',
  'wearables',
  'cameras',
  'lenses',
  'consoles',
  'networking',
  'power_tools',
  'appliances',
  'tvs',
  'monitors',
  'accessories',
];

/** Storage hard-mismatch applies mainly to phone/laptop profiles. */
export function shouldPenalizeStorageMismatch(category: ProductCategory): boolean {
  return !NO_STORAGE_PENALTY_CATEGORIES.includes(category);
}
