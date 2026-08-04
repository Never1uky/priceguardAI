/**
 * Hybrid rule-pack loader: bundled default now; remote overlay interface for later.
 * Remote packs must be data-only (pattern strings) — never executable code.
 */

import { BUNDLED_MATCH_RULE_PACK } from '@/lib/match-rules/bundled-pack';
import type {
  CompiledMatchRules,
  MatchRulePack,
} from '@/lib/match-rules/types';

const MAX_PATTERN_LENGTH = 240;

let activeCompiled: CompiledMatchRules | null = null;
let remoteOverlay: MatchRulePack | null = null;

function safeCompile(pattern: string, flags = ''): RegExp | null {
  const trimmed = pattern.slice(0, MAX_PATTERN_LENGTH);
  if (!trimmed) return null;
  try {
    return new RegExp(trimmed, flags);
  } catch {
    return null;
  }
}

export function compileMatchRulePack(pack: MatchRulePack): CompiledMatchRules {
  return {
    rulesVersion: pack.rulesVersion,
    roleHardBlockMinConfidence: pack.roleHardBlockMinConfidence,
    roleLexicon: pack.roleLexicon
      .map((e) => {
        const re = safeCompile(e.pattern, e.flags ?? 'i');
        return re ? { ...e, re } : null;
      })
      .filter((e): e is NonNullable<typeof e> => e != null),
    hostFamilies: pack.hostFamilies
      .map((e) => {
        const re = safeCompile(e.pattern, e.flags ?? 'i');
        if (!re) return null;
        const hostRe = e.hostCapture
          ? safeCompile(e.hostCapture, e.hostCaptureFlags ?? 'i') ?? undefined
          : undefined;
        return { ...e, re, hostRe };
      })
      .filter((e): e is NonNullable<typeof e> => e != null),
    entityHints: pack.entityHints
      .map((e) => {
        const re = safeCompile(e.pattern, e.flags ?? 'i');
        return re ? { ...e, re } : null;
      })
      .filter((e): e is NonNullable<typeof e> => e != null),
    marketingStrip: pack.marketingStrip
      .map((e) => {
        const re = safeCompile(e.pattern, e.flags ?? 'i');
        return re ? { ...e, re } : null;
      })
      .filter((e): e is NonNullable<typeof e> => e != null),
    roleRelations: pack.roleRelations.filter((r) => r.hardBlock),
  };
}

/**
 * Merge remote overlay onto bundled pack.
 * Overlay replaces arrays it provides; schema/version validated shallowly.
 */
export function mergeMatchRulePacks(
  base: MatchRulePack,
  overlay: MatchRulePack | null | undefined,
): MatchRulePack {
  if (!overlay || !overlay.rulesVersion) return base;
  return {
    rulesVersion: overlay.rulesVersion,
    roleHardBlockMinConfidence:
      overlay.roleHardBlockMinConfidence ?? base.roleHardBlockMinConfidence,
    roleLexicon: overlay.roleLexicon?.length ? overlay.roleLexicon : base.roleLexicon,
    hostFamilies: overlay.hostFamilies?.length ? overlay.hostFamilies : base.hostFamilies,
    entityHints: overlay.entityHints?.length ? overlay.entityHints : base.entityHints,
    marketingStrip: overlay.marketingStrip?.length
      ? overlay.marketingStrip
      : base.marketingStrip,
    roleRelations: overlay.roleRelations?.length ? overlay.roleRelations : base.roleRelations,
  };
}

/** Invalidate compiled cache (tests / after remote apply). */
export function resetMatchRulesCache(): void {
  activeCompiled = null;
}

/**
 * Install remote overlay (chrome.storage / edge fetch). Data-only.
 * Call resetMatchRulesCache after set so next getActiveCompiledRules recompiles.
 */
export function setRemoteMatchRuleOverlay(pack: MatchRulePack | null): void {
  remoteOverlay = pack;
  resetMatchRulesCache();
}

export function getRemoteMatchRuleOverlay(): MatchRulePack | null {
  return remoteOverlay;
}

export function getBundledMatchRulePack(): MatchRulePack {
  return BUNDLED_MATCH_RULE_PACK;
}

/** Active merged + compiled rules (bundled ± remote overlay). */
export function getActiveCompiledRules(): CompiledMatchRules {
  if (!activeCompiled) {
    const merged = mergeMatchRulePacks(BUNDLED_MATCH_RULE_PACK, remoteOverlay);
    activeCompiled = compileMatchRulePack(merged);
  }
  return activeCompiled;
}

/**
 * Future: fetch versioned pack from edge, verify hash, cache in chrome.storage.
 * Stub keeps API stable without network in MVP.
 */
export async function fetchRemoteMatchRulePack(_opts?: {
  url?: string;
}): Promise<MatchRulePack | null> {
  return null;
}
