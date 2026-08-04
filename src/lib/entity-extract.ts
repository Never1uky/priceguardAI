/**
 * Entity / role extraction: primary entity vs compatibility host vs marketing.
 * Feeds query builder and role-relation hard gates.
 */

import { getActiveCompiledRules } from '@/lib/match-rules';
import {
  isDependentProductRole,
  type EntityExtraction,
  type HostFamily,
  type ProductRole,
} from '@/lib/match-rules/types';

/** Light brand scan — avoids circular import with model-extract. */
const LIGHT_BRANDS = [
  'sony',
  'hp',
  'dyson',
  'nespresso',
  'makita',
  'bosch',
  'apple',
  'samsung',
  'oral-b',
  'oralb',
  'canon',
  'epson',
  'xiaomi',
  'royal canin',
];

function detectBrandLight(title: string): string | undefined {
  const lower = title.toLowerCase();
  return LIGHT_BRANDS.find((b) => lower.includes(b));
}

const HOST_PREPOSITION =
  /(?:^|[\s,.;:(])(?:для|for|под|совместим(?:ый|ая|ое|ые)?\s+с|compatible\s+with)\s+/i;

/** Bundle / kit markers — accessory words after these are комплектация, not SKU role */
const BUNDLE_CLAUSE =
  /(?:в\s+комплекте|комплектаци\w*|включ[её]н\w*|вместе\s+с|дополнительно|\+\s*)/i;

/** Title leads that mean the SKU is the host device itself */
const HOST_PRODUCT_LEAD =
  /(?:игровая\s+приставк\w*|приставк\w*|смартфон\w*|телефон\w*|принтер\w*|мфу|пылесос\w*|кофемашин\w*|toothbrush|зубн\w*\s+щ[её]тк)/i;

/** Title leads that mean the SKU is the accessory / consumable */
const ACCESSORY_SKU_LEAD =
  /^(?:беспроводн\w*\s+|оригинальн\w*\s+|новый\s+|новая\s+)?(?:dual\s*sense|dualshock|геймпад\w*|джойстик\w*|контроллер\w*|controller|gamepad|чехол\w*|case|картридж\w*|фильтр\w*|насадк\w*|капсул\w*|плёнк\w*|пленк\w*)/i;

function normalizeSpaces(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function findHostFamily(text: string): {
  family: HostFamily;
  host?: string;
} | null {
  const rules = getActiveCompiledRules();
  for (const entry of rules.hostFamilies) {
    if (!entry.re.test(text)) continue;
    let host: string | undefined;
    if (entry.hostRe) {
      const m = text.match(entry.hostRe);
      if (m?.[1]) host = normalizeSpaces(m[1]);
      else if (m?.[0]) host = normalizeSpaces(m[0]);
    }
    return { family: entry.family, host };
  }
  return null;
}

function findRoleLexicon(text: string): {
  role: ProductRole;
  typeNoun?: string;
} | null {
  const rules = getActiveCompiledRules();
  for (const entry of rules.roleLexicon) {
    if (entry.re.test(text)) {
      return { role: entry.role, typeNoun: entry.typeNoun };
    }
  }
  return null;
}

function findEntityHint(text: string): {
  entity: string;
  role?: ProductRole;
  hostFamily?: HostFamily;
  typeNoun?: string;
} | null {
  const rules = getActiveCompiledRules();
  for (const entry of rules.entityHints) {
    if (entry.re.test(text)) {
      return {
        entity: entry.entity,
        role: entry.role,
        hostFamily: entry.hostFamily,
        typeNoun: entry.typeNoun,
      };
    }
  }
  return null;
}

function extractMarketing(text: string): string[] {
  const rules = getActiveCompiledRules();
  const found: string[] = [];
  for (const entry of rules.marketingStrip) {
    const m = text.match(entry.re);
    if (m?.[0]) found.push(m[0].toLowerCase());
  }
  return found;
}

function extractHostAfterPreposition(text: string): string | undefined {
  const idx = text.search(HOST_PREPOSITION);
  if (idx < 0) return undefined;
  const after = text.slice(idx).replace(HOST_PREPOSITION, '').trim();
  if (!after) return undefined;
  // Take up to ~6 tokens of the host NP
  const tokens = after.split(/\s+/).slice(0, 6);
  return normalizeSpaces(tokens.join(' ')).slice(0, 60) || undefined;
}

/** Drop «в комплекте …» / «+ DualSense» tails so bundle accessories do not set role. */
function stripBundleClauses(text: string): string {
  const idx = text.search(BUNDLE_CLAUSE);
  if (idx < 0) return text;
  return normalizeSpaces(text.slice(0, idx));
}

/**
 * True when the title is an accessory/consumable FOR a host
 * (e.g. «контроллер для PS5», «чехол для iPhone»), not a host with kit noise.
 */
function isAccessoryForHostTitle(title: string, hostFromPrep: string | undefined): boolean {
  if (hostFromPrep) return true;
  const t = title.trim();
  if (HOST_PRODUCT_LEAD.test(t)) return false;
  if (ACCESSORY_SKU_LEAD.test(t)) return true;
  return false;
}

function stripMarketingAndHost(
  text: string,
  host?: string,
  marketing: string[] = [],
): string {
  let t = text;
  for (const m of marketing) {
    t = t.replace(new RegExp(m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), ' ');
  }
  if (host) {
    t = t.replace(new RegExp(host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), ' ');
  }
  t = t
    .replace(HOST_PREPOSITION, ' ')
    .replace(
      /\b(?:беспроводн\w*|wireless|оригинальн\w*|original|белый|черный|чёрный|синий|white|black)\b/gi,
      ' ',
    );
  return normalizeSpaces(t);
}

/**
 * Extract primary entity, compatibility host, and product role from a title.
 */
export function extractEntityFromTitle(
  title: string,
  _specs?: string,
): EntityExtraction {
  const titleOnly = normalizeSpaces(title);
  const text = normalizeSpaces(`${title} ${_specs ?? ''}`);
  if (!text || text === 'Товар') {
    return {
      primaryEntity: '',
      productRole: 'primary',
      marketing: [],
      confidence: 0,
    };
  }

  const brand = detectBrandLight(text);
  const marketing = extractMarketing(text);
  const hostInTitle = findHostFamily(titleOnly);
  const hostFromPrep = extractHostAfterPreposition(titleOnly);

  // When title already looks like a host device, ignore accessory words in bundle/specs
  const accessoryScanText =
    hostInTitle && !isAccessoryForHostTitle(titleOnly, hostFromPrep)
      ? stripBundleClauses(titleOnly)
      : text;

  const lexicon = findRoleLexicon(accessoryScanText);
  const hint = findEntityHint(accessoryScanText);
  const hostInfo = hostInTitle ?? findHostFamily(text);

  const accessorySignal = Boolean(
    (hint?.role && isDependentProductRole(hint.role)) ||
      (lexicon?.role && isDependentProductRole(lexicon.role)),
  );

  let productRole: ProductRole = hint?.role ?? lexicon?.role ?? 'primary';
  let typeNoun = hint?.typeNoun ?? lexicon?.typeNoun;
  let useHintEntity = Boolean(hint?.entity);

  // Host SKU with kit / specs mentioning DualSense/чехол/картридж → stay primary
  if (
    hostInTitle &&
    accessorySignal &&
    !isAccessoryForHostTitle(titleOnly, hostFromPrep)
  ) {
    productRole = 'primary';
    typeNoun = undefined;
    useHintEntity = false;
  }

  const hostFamily: HostFamily | undefined =
    (useHintEntity ? hint?.hostFamily : undefined) ??
    hostInfo?.family ??
    (productRole === 'primary' ? hostInfo?.family : undefined) ??
    hint?.hostFamily;

  let compatibilityHost =
    hostFromPrep ??
    hostInfo?.host ??
    (isDependentProductRole(productRole) ? hostInfo?.host : undefined);

  // Dependent + host family from title without explicit capture
  if (isDependentProductRole(productRole) && !compatibilityHost && hostInfo?.host) {
    compatibilityHost = hostInfo.host;
  }

  let primaryEntity = '';
  let confidence = 0.35;

  if (useHintEntity && hint?.entity) {
    primaryEntity = hint.entity;
    confidence = 0.85;
  } else if (isDependentProductRole(productRole)) {
    const stripped = stripMarketingAndHost(text, compatibilityHost, marketing);
    // Prefer distinctive tokens: brand + typeNoun + remaining model-ish words
    const parts: string[] = [];
    if (typeNoun && !stripped.toLowerCase().includes(typeNoun.toLowerCase())) {
      // keep typeNoun in query separately; entity = distinctive remainder
    }
    const words = stripped
      .split(/\s+/)
      .filter((w) => w.length > 1)
      .filter((w) => !typeNoun || w.toLowerCase() !== typeNoun.toLowerCase())
      .slice(0, 5);
    if (brand && !words.some((w) => w.toLowerCase() === brand)) {
      parts.push(brand);
    }
    if (typeNoun) parts.push(typeNoun);
    parts.push(...words);
    primaryEntity = normalizeSpaces(parts.join(' ')).slice(0, 80);
    confidence = lexicon && hostFamily ? 0.75 : lexicon ? 0.6 : 0.45;
  } else {
    // Primary device: entity is the host/device itself
    primaryEntity = hostInfo?.host
      ? hostInfo.host
      : stripMarketingAndHost(titleOnly, undefined, marketing).split(/\s+/).slice(0, 5).join(' ');
    confidence = hostInfo ? 0.7 : 0.4;
  }

  // Nespresso capsules: entity hint sets brand-like entity; keep typeNoun
  if (useHintEntity && hint?.entity && typeNoun && productRole !== 'primary') {
    primaryEntity = normalizeSpaces(`${typeNoun} ${hint.entity}`).slice(0, 80);
  }

  return {
    primaryEntity: normalizeSpaces(primaryEntity),
    brand,
    productRole,
    compatibilityHost: compatibilityHost
      ? normalizeSpaces(compatibilityHost).slice(0, 60)
      : undefined,
    hostFamily: hostFamily === 'generic' ? undefined : hostFamily,
    marketing,
    typeNoun,
    confidence,
  };
}

/** Lead SERP query from primary entity (never host-only for dependents). */
export function buildPrimaryEntityQuery(extraction: EntityExtraction): string {
  if (!extraction.primaryEntity) return '';
  const parts: string[] = [];
  if (
    extraction.brand &&
    !extraction.primaryEntity.toLowerCase().includes(extraction.brand.toLowerCase())
  ) {
    parts.push(extraction.brand);
  }
  // Avoid duplicating typeNoun if already inside primaryEntity
  if (
    extraction.typeNoun &&
    !extraction.primaryEntity.toLowerCase().includes(extraction.typeNoun.toLowerCase())
  ) {
    parts.push(extraction.typeNoun);
  }
  parts.push(extraction.primaryEntity);
  return normalizeSpaces(parts.join(' ')).slice(0, 80);
}

/** Secondary variant: primary + short host (DualSense PS5). */
export function buildPrimaryWithHostQuery(extraction: EntityExtraction): string | undefined {
  const lead = buildPrimaryEntityQuery(extraction);
  if (!lead || !extraction.compatibilityHost) return undefined;
  const hostShort = extraction.compatibilityHost.split(/\s+/).slice(0, 3).join(' ');
  if (!hostShort) return undefined;
  if (lead.toLowerCase().includes(hostShort.toLowerCase())) return undefined;
  return normalizeSpaces(`${lead} ${hostShort}`).slice(0, 80);
}

/** True if query is effectively only the compatibility host (poisoned lead). */
export function isHostOnlyQuery(query: string, extraction: EntityExtraction): boolean {
  const q = normalizeSpaces(query).toLowerCase();
  if (!q || q.length < 3) return false;
  if (!isDependentProductRole(extraction.productRole)) return false;
  const host = extraction.compatibilityHost?.toLowerCase();
  const familyHost = extraction.hostFamily;
  if (!host && !familyHost) return false;

  const primary = extraction.primaryEntity.toLowerCase();
  if (primary && q.includes(primary.split(/\s+/)[0]!) && primary.length >= 4) {
    // Contains distinctive primary token
    const primaryTokens = primary.split(/\s+/).filter((t) => t.length >= 4);
    if (primaryTokens.some((t) => q.includes(t))) return false;
  }

  if (host) {
    const hostCore = host.replace(/\s+/g, ' ');
    if (q === hostCore || hostCore.includes(q) || q.includes(hostCore.split(/\s+/)[0]!)) {
      // Query is host-like and missing primary entity tokens
      const entityToken = primary.split(/\s+/).find((t) => t.length >= 4);
      if (!entityToken || !q.includes(entityToken)) return true;
    }
  }

  // Console host-only: playstation / ps5 without dualsense etc.
  if (familyHost === 'console' && /\b(?:playstation|ps\s*[45]|xbox|nintendo\s+switch)\b/i.test(q)) {
    const entityToken = primary.split(/\s+/).find((t) => t.length >= 4);
    if (!entityToken || !q.includes(entityToken)) return true;
  }
  if (familyHost === 'phone' && /\b(?:iphone|galaxy|смартфон)\b/i.test(q) && /чехол|case/i.test(extraction.typeNoun ?? extraction.primaryEntity) === false) {
    // phone host query for case role
    if (extraction.productRole === 'accessory' && !/чехол|case|плёнк|пленк|стекл/i.test(q)) {
      return true;
    }
  }

  return false;
}

/**
 * Rewrite a poisoned host-only (or wiped) query to the primary-entity lead.
 */
export function enforcePrimaryLeadQuery(
  query: string,
  titleHint: string,
  specs?: string,
): string {
  const extraction = extractEntityFromTitle(titleHint, specs);
  if (!isDependentProductRole(extraction.productRole)) {
    return query;
  }
  const lead = buildPrimaryEntityQuery(extraction);
  if (!lead || lead.length < 3) return query;
  const q = normalizeSpaces(query);
  if (!q || isHostOnlyQuery(q, extraction)) {
    return lead;
  }
  return q;
}

/**
 * Hard role-relation incompatibility (accessory/consumable ↔ host primary, same family).
 */
export function areEntityRolesIncompatible(
  referenceTitle: string,
  candidateTitle: string,
  referenceSpecs?: string,
): boolean {
  const rules = getActiveCompiledRules();
  const ref = extractEntityFromTitle(referenceTitle, referenceSpecs);
  const cand = extractEntityFromTitle(candidateTitle);

  const minConf = rules.roleHardBlockMinConfidence;
  if (ref.confidence < minConf && cand.confidence < minConf) return false;

  for (const relation of rules.roleRelations) {
    if (!relation.hardBlock) continue;
    if (!relation.refRoles.includes(ref.productRole)) continue;
    if (!relation.candRoles.includes(cand.productRole)) continue;

    if (relation.requireSameFamily) {
      const refFam = ref.hostFamily;
      const candFam = cand.hostFamily;
      // Candidate primary of family: hostFamily set from device markers
      if (!refFam || !candFam || refFam !== candFam) continue;
      // Prefer blocking when at least one side is confident
      if (Math.max(ref.confidence, cand.confidence) < minConf) continue;
      return true;
    }
    return true;
  }
  return false;
}

/** Titles compatible under category + role gates. */
export function areTitlesEntityCompatible(
  referenceTitle: string,
  candidateTitle: string,
  referenceSpecs?: string,
): boolean {
  return !areEntityRolesIncompatible(referenceTitle, candidateTitle, referenceSpecs);
}
