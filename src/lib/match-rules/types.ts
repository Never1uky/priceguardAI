/**
 * Declarative match-rule types (entity roles, host families, relation matrix).
 * Data lives in rule packs; scoring/query engines consume these shapes only.
 */

/** Role of the SKU relative to a host device / product line. */
export type ProductRole = 'primary' | 'accessory' | 'consumable' | 'part' | 'supply';

/** Host device family for accessory/consumable ↔ primary hard blocks. */
export type HostFamily =
  | 'console'
  | 'phone'
  | 'printer'
  | 'vacuum'
  | 'toothbrush'
  | 'power_tool'
  | 'coffee'
  | 'pet'
  | 'generic';

/** Roles that attach to / consume a host primary device. */
export const DEPENDENT_PRODUCT_ROLES: readonly ProductRole[] = [
  'accessory',
  'consumable',
  'part',
  'supply',
] as const;

export function isDependentProductRole(role: ProductRole): boolean {
  return (DEPENDENT_PRODUCT_ROLES as readonly string[]).includes(role);
}

export interface EntityExtraction {
  /** Distinctive product entity used as SERP lead (e.g. DualSense, картридж HP). */
  primaryEntity: string;
  brand?: string;
  productRole: ProductRole;
  /** Host the item is for (PlayStation 5, iPhone 15, Dyson V15). */
  compatibilityHost?: string;
  hostFamily?: HostFamily;
  /** Marketing / filler tokens stripped from lead query. */
  marketing: string[];
  /** Optional type noun (контроллер, чехол, фильтр). */
  typeNoun?: string;
  /** 0–1 confidence; hard role gates require ≥ ROLE_HARD_BLOCK_MIN_CONFIDENCE. */
  confidence: number;
}

/** Hard block when ref/cand roles conflict on the same host family. */
export interface RoleRelationRule {
  id: string;
  refRoles: ProductRole[];
  candRoles: ProductRole[];
  /** When true, both sides must share a non-generic hostFamily. */
  requireSameFamily: boolean;
  hardBlock: boolean;
}

export interface RoleLexiconEntry {
  id: string;
  role: ProductRole;
  /** Source pattern string — compiled by loader. */
  pattern: string;
  flags?: string;
  typeNoun?: string;
}

export interface HostFamilyEntry {
  family: HostFamily;
  /** Detects host / primary device of this family. */
  pattern: string;
  flags?: string;
  /** Captures normalized host phrase when possible (group 1). */
  hostCapture?: string;
  hostCaptureFlags?: string;
}

export interface EntityHintEntry {
  id: string;
  /** Distinctive entity name for query lead. */
  entity: string;
  pattern: string;
  flags?: string;
  role?: ProductRole;
  hostFamily?: HostFamily;
  typeNoun?: string;
}

export interface MarketingStripEntry {
  id: string;
  pattern: string;
  flags?: string;
}

/**
 * Versioned rule pack — bundled in extension; remote overlay may replace lexicons later.
 * No executable code from remote: only data strings compiled locally.
 */
export interface MatchRulePack {
  rulesVersion: string;
  roleLexicon: RoleLexiconEntry[];
  hostFamilies: HostFamilyEntry[];
  entityHints: EntityHintEntry[];
  marketingStrip: MarketingStripEntry[];
  roleRelations: RoleRelationRule[];
  /** Min confidence to apply hard role↔primary block. */
  roleHardBlockMinConfidence: number;
}

/** Compiled runtime view of a pack. */
export interface CompiledMatchRules {
  rulesVersion: string;
  roleHardBlockMinConfidence: number;
  roleLexicon: Array<RoleLexiconEntry & { re: RegExp }>;
  hostFamilies: Array<
    HostFamilyEntry & { re: RegExp; hostRe?: RegExp }
  >;
  entityHints: Array<EntityHintEntry & { re: RegExp }>;
  marketingStrip: Array<MarketingStripEntry & { re: RegExp }>;
  roleRelations: RoleRelationRule[];
}
