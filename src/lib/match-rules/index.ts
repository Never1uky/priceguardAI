/**
 * Hybrid rule-pack loader: bundled default now; remote overlay interface for later.
 * Remote packs must be data-only (pattern strings) — never executable code.
 */

import { BUNDLED_MATCH_RULE_PACK } from '@/lib/match-rules/bundled-pack';
import type {
  CompiledMatchRules,
  MatchRulePack,
} from '@/lib/match-rules/types';
import { resolveMatchFeatureFlags, type MatchFeatureFlags } from '@/lib/match-flags';

const MAX_PATTERN_LENGTH = 240;

let activeCompiled: CompiledMatchRules | null = null;
let remoteOverlay: MatchRulePack | null = null;
let activeSource: 'bundled' | 'remote' = 'bundled';
let activeReason = 'bundled_default';

export interface MatchRulePackApplyResult {
  applied: boolean;
  source: 'bundled' | 'remote';
  reason:
    | 'remote_applied'
    | 'remote_disabled'
    | 'remote_unavailable'
    | 'invalid_payload'
    | 'invalid_version'
    | 'compile_failed'
    | 'bundled_default';
  rulesVersion: string;
}

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

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value != null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isStringArrayOfObjects<T extends Record<string, unknown>>(
  input: unknown,
  requiredKeys: string[],
): input is T[] {
  if (!Array.isArray(input)) return false;
  return input.every((item) => {
    if (!isObject(item)) return false;
    return requiredKeys.every((k) => isNonEmptyString(item[k]));
  });
}

function parseVersion(value: string): number[] {
  return value.split('.').map((p) => Number.parseInt(p, 10));
}

function isVersionAtLeast(candidate: string, baseline: string): boolean {
  const a = parseVersion(candidate);
  const b = parseVersion(baseline);
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (!Number.isFinite(av) || !Number.isFinite(bv)) return false;
    if (av > bv) return true;
    if (av < bv) return false;
  }
  return true;
}

export function validateMatchRulePack(payload: unknown): {
  ok: boolean;
  reason?: 'invalid_payload' | 'invalid_version';
  pack?: MatchRulePack;
} {
  if (!isObject(payload)) return { ok: false, reason: 'invalid_payload' };
  if (!isNonEmptyString(payload.rulesVersion)) {
    return { ok: false, reason: 'invalid_payload' };
  }
  if (!isVersionAtLeast(payload.rulesVersion, BUNDLED_MATCH_RULE_PACK.rulesVersion)) {
    return { ok: false, reason: 'invalid_version' };
  }
  if (
    typeof payload.roleHardBlockMinConfidence !== 'number' ||
    payload.roleHardBlockMinConfidence < 0 ||
    payload.roleHardBlockMinConfidence > 1
  ) {
    return { ok: false, reason: 'invalid_payload' };
  }
  if (!isStringArrayOfObjects(payload.roleLexicon, ['id', 'role', 'pattern'])) {
    return { ok: false, reason: 'invalid_payload' };
  }
  if (!isStringArrayOfObjects(payload.hostFamilies, ['family', 'pattern'])) {
    return { ok: false, reason: 'invalid_payload' };
  }
  if (!isStringArrayOfObjects(payload.entityHints, ['id', 'entity', 'pattern'])) {
    return { ok: false, reason: 'invalid_payload' };
  }
  if (!isStringArrayOfObjects(payload.marketingStrip, ['id', 'pattern'])) {
    return { ok: false, reason: 'invalid_payload' };
  }
  if (!Array.isArray(payload.roleRelations)) {
    return { ok: false, reason: 'invalid_payload' };
  }
  return { ok: true, pack: payload as unknown as MatchRulePack };
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
  activeSource = pack ? 'remote' : 'bundled';
  activeReason = pack ? 'remote_applied' : 'bundled_default';
  resetMatchRulesCache();
}

export function getRemoteMatchRuleOverlay(): MatchRulePack | null {
  return remoteOverlay;
}

export function getBundledMatchRulePack(): MatchRulePack {
  return BUNDLED_MATCH_RULE_PACK;
}

export function getActiveRulePackMeta(): {
  source: 'bundled' | 'remote';
  reason: string;
  rulesVersion: string;
} {
  return {
    source: activeSource,
    reason: activeReason,
    rulesVersion: getActiveCompiledRules().rulesVersion,
  };
}

export function applyRemoteMatchRulePack(
  payload: unknown,
  flags?: Partial<MatchFeatureFlags>,
): MatchRulePackApplyResult {
  const resolvedFlags = resolveMatchFeatureFlags(flags);
  if (!resolvedFlags.enableRemoteRulePack) {
    setRemoteMatchRuleOverlay(null);
    activeReason = 'remote_disabled';
    return {
      applied: false,
      source: 'bundled',
      reason: 'remote_disabled',
      rulesVersion: BUNDLED_MATCH_RULE_PACK.rulesVersion,
    };
  }

  const validated = validateMatchRulePack(payload);
  if (!validated.ok || !validated.pack) {
    setRemoteMatchRuleOverlay(null);
    activeReason = validated.reason ?? 'invalid_payload';
    return {
      applied: false,
      source: 'bundled',
      reason: validated.reason ?? 'invalid_payload',
      rulesVersion: BUNDLED_MATCH_RULE_PACK.rulesVersion,
    };
  }

  const merged = mergeMatchRulePacks(BUNDLED_MATCH_RULE_PACK, validated.pack);
  const compiled = compileMatchRulePack(merged);
  if (
    compiled.roleLexicon.length === 0 ||
    compiled.hostFamilies.length === 0 ||
    compiled.roleRelations.length === 0
  ) {
    setRemoteMatchRuleOverlay(null);
    activeReason = 'compile_failed';
    return {
      applied: false,
      source: 'bundled',
      reason: 'compile_failed',
      rulesVersion: BUNDLED_MATCH_RULE_PACK.rulesVersion,
    };
  }
  remoteOverlay = merged;
  activeCompiled = compiled;
  activeSource = 'remote';
  activeReason = 'remote_applied';
  return {
    applied: true,
    source: 'remote',
    reason: 'remote_applied',
    rulesVersion: compiled.rulesVersion,
  };
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

export async function tryLoadRemoteMatchRulePack(
  flags?: Partial<MatchFeatureFlags>,
): Promise<MatchRulePackApplyResult> {
  const resolvedFlags = resolveMatchFeatureFlags(flags);
  if (!resolvedFlags.enableRemoteRulePack) {
    return applyRemoteMatchRulePack(null, resolvedFlags);
  }
  try {
    const payload = await fetchRemoteMatchRulePack();
    if (!payload) {
      setRemoteMatchRuleOverlay(null);
      activeReason = 'remote_unavailable';
      return {
        applied: false,
        source: 'bundled',
        reason: 'remote_unavailable',
        rulesVersion: BUNDLED_MATCH_RULE_PACK.rulesVersion,
      };
    }
    return applyRemoteMatchRulePack(payload, resolvedFlags);
  } catch {
    setRemoteMatchRuleOverlay(null);
    activeReason = 'remote_unavailable';
    return {
      applied: false,
      source: 'bundled',
      reason: 'remote_unavailable',
      rulesVersion: BUNDLED_MATCH_RULE_PACK.rulesVersion,
    };
  }
}
