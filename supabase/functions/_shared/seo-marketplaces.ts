/**
 * SEO marketplace allowlist — single source for slug shorts, title strip, publish/offers gates.
 * Keep in sync with src/lib/seo/seo-marketplaces.ts
 *
 * Do NOT import extension registry here — SEO publish is intentionally narrower than compare.
 */

export interface SeoMarketplaceEntry {
  id: string;
  shortSlug: string;
  label: string;
  titleStripAliases: readonly string[];
  publishAllowed: boolean;
  offersAllowed: boolean;
  hostSuffixes?: readonly string[];
}

export const SEO_MARKETPLACES: readonly SeoMarketplaceEntry[] = [
  {
    id: 'wildberries',
    shortSlug: 'wb',
    label: 'Wildberries',
    titleStripAliases: ['wildberries', 'wb'],
    publishAllowed: true,
    offersAllowed: true,
    hostSuffixes: ['wildberries.ru'],
  },
  {
    id: 'ozon',
    shortSlug: 'ozon',
    label: 'Ozon',
    titleStripAliases: ['ozon'],
    publishAllowed: true,
    offersAllowed: true,
    hostSuffixes: ['ozon.ru'],
  },
  {
    id: 'yandex_market',
    shortSlug: 'ym',
    label: 'Яндекс Маркет',
    titleStripAliases: ['яндекс маркет', 'яндекс.маркет', 'yandex market', 'ym'],
    publishAllowed: true,
    offersAllowed: true,
    hostSuffixes: ['market.yandex.ru'],
  },
  {
    id: 'megamarket',
    shortSlug: 'mm',
    label: 'Мегамаркет',
    titleStripAliases: ['megamarket', 'мегамаркет', 'mm', 'sbermegamarket'],
    publishAllowed: true,
    offersAllowed: true,
    hostSuffixes: ['megamarket.ru', 'sbermegamarket.ru'],
  },
  {
    id: 'aliexpress',
    shortSlug: 'ae',
    label: 'AliExpress',
    titleStripAliases: ['aliexpress', 'алиэкспресс', 'ae'],
    publishAllowed: true,
    offersAllowed: true,
    hostSuffixes: ['aliexpress.ru'],
  },
  {
    id: 'mvideo',
    shortSlug: 'mvideo',
    label: 'М.Видео',
    titleStripAliases: ['mvideo', 'м.видео', 'мвидео', 'eldorado', 'эльдорадо'],
    publishAllowed: false,
    offersAllowed: false,
    hostSuffixes: ['mvideo.ru', 'eldorado.ru'],
  },
  {
    id: 'dns',
    shortSlug: 'dns',
    label: 'DNS',
    titleStripAliases: ['dns', 'dns-shop'],
    publishAllowed: false,
    offersAllowed: false,
    hostSuffixes: ['dns-shop.ru'],
  },
  {
    id: 'citilink',
    shortSlug: 'citi',
    label: 'Ситилинк',
    titleStripAliases: ['citilink', 'ситилинк', 'citi'],
    publishAllowed: false,
    offersAllowed: false,
    hostSuffixes: ['citilink.ru'],
  },
  {
    id: 'lamoda',
    shortSlug: 'lamoda',
    label: 'Lamoda',
    titleStripAliases: ['lamoda', 'ламода'],
    publishAllowed: false,
    offersAllowed: false,
    hostSuffixes: ['lamoda.ru'],
  },
];

const BY_ID = new Map(SEO_MARKETPLACES.map((e) => [e.id, e]));

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function aliasToRegexFragment(alias: string): string {
  const trimmed = alias.trim();
  if (!trimmed) return '';
  if (/\s/.test(trimmed)) {
    return trimmed
      .split(/\s+/)
      .map((w) => escapeRegex(w))
      .join('\\s*');
  }
  if (trimmed.includes('.')) {
    return trimmed
      .split('.')
      .map((w) => escapeRegex(w))
      .join('\\.?');
  }
  return escapeRegex(trimmed);
}

let _stripAlternation: string | null = null;

export function seoTitleStripAlternation(): string {
  if (_stripAlternation) return _stripAlternation;
  const parts: string[] = [];
  const seen = new Set<string>();
  for (const e of SEO_MARKETPLACES) {
    for (const a of e.titleStripAliases) {
      const frag = aliasToRegexFragment(a);
      if (!frag || seen.has(frag.toLowerCase())) continue;
      seen.add(frag.toLowerCase());
      parts.push(frag);
    }
  }
  _stripAlternation = parts.join('|');
  return _stripAlternation;
}

export function seoMpShort(marketplace: string): string {
  return BY_ID.get(marketplace)?.shortSlug ?? 'mp';
}

export function seoMarketplaceLabel(marketplace: string): string {
  return BY_ID.get(marketplace)?.label ?? marketplace;
}

export function getSeoMarketplaceEntry(id: string): SeoMarketplaceEntry | undefined {
  return BY_ID.get(id);
}

export function seoPublishableIds(): string[] {
  return SEO_MARKETPLACES.filter((e) => e.publishAllowed).map((e) => e.id);
}

export function seoOffersIds(): string[] {
  return SEO_MARKETPLACES.filter((e) => e.offersAllowed).map((e) => e.id);
}

export function isSeoPublishableMp(id: string): boolean {
  return BY_ID.get(id)?.publishAllowed === true;
}

export function isSeoOffersMp(id: string): boolean {
  return BY_ID.get(id)?.offersAllowed === true;
}

export function seoMarketplaceHostAlternation(): string {
  const hosts: string[] = [];
  for (const e of SEO_MARKETPLACES) {
    for (const h of e.hostSuffixes ?? []) {
      hosts.push(escapeRegex(h));
    }
  }
  return hosts.join('|');
}

export function seoAllShortSlugs(): string[] {
  return SEO_MARKETPLACES.map((e) => e.shortSlug);
}
