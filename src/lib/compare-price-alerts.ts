import { offersFromCompareProduct, isOfferWithPrice } from '@/lib/compare-offers';
import {
  dispatchCheaperElsewhereAlert,
  dispatchComparePriceDropAlert,
} from '@/lib/price-alert-dispatch';
import {
  isSuspiciousIdentityDrop,
  logPriceIdentityReject,
  productsIdentityMatch,
  resolveProductArticle,
} from '@/lib/price-identity';
import { offerMatchStatus } from '@/lib/match-status';
import { isOutOfStockError } from '@/lib/out-of-stock';
import { detectComparisonMarketplace, normalizeCompareUrl } from '@/utils/comparison-url';
import type { CompareProduct, ComparisonMarketplace, MarketplaceOffer } from '@/types/comparison';
import type { Marketplace } from '@/types/product';
import { getSelectedSearchMarketplaces } from '@/lib/marketplaces/search-settings';

/** После add не слать compare-алерты (Chrome+TG) — только baseline. */
export const COMPARE_ALERT_GRACE_MS = 45 * 60 * 1000;

const SETTINGS_KEY = 'priceguard_price_alert_settings';

export interface PriceAlertSettings {
  /** Глобальный выключатель уведомлений о падении цены и целевой цене */
  notificationsEnabled: boolean;
  /** Минимальное падение в рублях для уведомления */
  minDropRub: number;
  /** Минимальное падение в процентах (0 = любое) */
  minDropPercent: number;
  /** Уведомлять о снижении цен в сравнении */
  compareAlerts: boolean;
  /** Дублировать уведомления в Telegram */
  telegramEnabled: boolean;
  /** Chat ID пользователя (@userinfobot) */
  telegramChatId: string;
}

const DEFAULT_SETTINGS: PriceAlertSettings = {
  notificationsEnabled: true,
  minDropRub: 100,
  minDropPercent: 1,
  compareAlerts: true,
  telegramEnabled: false,
  telegramChatId: '',
};

export async function getPriceAlertSettings(): Promise<PriceAlertSettings> {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(stored[SETTINGS_KEY] as Partial<PriceAlertSettings> | undefined) };
}

/** Записать настройки локально без push в облако (для restore / избежания циклов). */
export async function applyPriceAlertSettingsLocal(
  patch: Partial<PriceAlertSettings>,
): Promise<PriceAlertSettings> {
  const current = await getPriceAlertSettings();
  const next = { ...current, ...patch };
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

function isSignificantDrop(
  previousPrice: number,
  newPrice: number,
  settings: PriceAlertSettings,
): boolean {
  if (newPrice >= previousPrice) return false;

  const drop = previousPrice - newPrice;
  const percent = (drop / previousPrice) * 100;

  const percentPass = settings.minDropPercent <= 0 || percent >= settings.minDropPercent;
  const rubPass = settings.minDropRub <= 0 || drop >= settings.minDropRub;

  return percentPass || rubPass;
}

/** Baseline for cross-MP: prefer OLD source price so a leaked new source price can't hide cheaper_elsewhere. */
function resolveOldSourcePrice(
  product: CompareProduct,
  oldOffers: MarketplaceOffer[],
): number | null {
  const fromOld = oldOffers.find((o) => o.marketplace === product.sourceMarketplace);
  if (isOfferWithPrice(fromOld)) return fromOld!.price!;

  if (isOfferWithPrice(product.sourceOffer)) return product.sourceOffer!.price!;

  return null;
}

/** Same product only via bound card URL / article — never title similarity alone. */
function isSameBoundProduct(oldOffer: MarketplaceOffer, newOffer: MarketplaceOffer): boolean {
  const mp = newOffer.marketplace as Marketplace;
  const match = productsIdentityMatch(
    {
      marketplace: mp,
      url: oldOffer.url,
      article: resolveProductArticle({ marketplace: mp, url: oldOffer.url }),
    },
    {
      marketplace: mp,
      url: newOffer.url,
      article: resolveProductArticle({ marketplace: mp, url: newOffer.url }),
    },
  );
  if (match.ok) return true;

  if (oldOffer.url && newOffer.url) {
    try {
      if (normalizeCompareUrl(oldOffer.url) === normalizeCompareUrl(newOffer.url)) {
        return Boolean(resolveProductArticle({ marketplace: mp, url: newOffer.url }));
      }
    } catch {
      /* ignore */
    }
  }

  logPriceIdentityReject(
    { marketplace: mp, url: oldOffer.url, title: oldOffer.title },
    { marketplace: mp, url: newOffer.url, title: newOffer.title },
    'compare_bound_mismatch',
  );
  return false;
}

/** Offer URL host must belong to claimed marketplace (blocks price/URL bleed across MPs). */
export function offerUrlMatchesMarketplace(offer: MarketplaceOffer): boolean {
  if (!offer.url) return false;
  const detected = detectComparisonMarketplace(offer.url);
  return detected === offer.marketplace;
}

/**
 * Alertable cross-MP / same-MP offer.
 * Uses offerMatchStatus (same as UI) — not only stored matchStatus==='verified'.
 * Never alert on OOS / out-of-stock errors (even if a SERP price leaked).
 */
export function isAlertableCompareOffer(offer: MarketplaceOffer): boolean {
  if (!isOfferWithPrice(offer)) return false;
  if (offer.matchStatus === 'oos') return false;
  if (offer.matchStatus === 'unverified_manual') return false;
  if (isOutOfStockError(offer.error)) return false;
  if (!offer.url || /search\?/i.test(offer.url)) return false;
  if (!offerUrlMatchesMarketplace(offer)) return false;

  const status = offerMatchStatus(offer);
  return status === 'verified' || status === 'probable' || status === 'serp_only';
}

/** Catastrophic cross-MP gap without verified identity → false alert (wrong SKU / OOS parse). */
function isCatastrophicCheaperElsewhere(
  sourcePrice: number,
  cheaperPrice: number,
  cheaperOffer: MarketplaceOffer,
): boolean {
  const status = offerMatchStatus(cheaperOffer);
  const identityOk = status === 'verified';
  if (isSuspiciousIdentityDrop(sourcePrice, cheaperPrice, identityOk)) return true;
  if (!identityOk && cheaperPrice < sourcePrice * 0.35 && sourcePrice - cheaperPrice > 20_000) {
    return true;
  }
  return false;
}

function pricesNearlyEqual(a: number, b: number): boolean {
  if (a === b) return true;
  const diff = Math.abs(a - b);
  if (diff <= 1) return true;
  return diff / Math.max(a, b) <= 0.002;
}

export type CompareAlertPlan =
  | {
      kind: 'compare_price_drop';
      marketplace: Marketplace;
      previousPrice: number;
      newPrice: number;
      url: string;
    }
  | {
      kind: 'cheaper_elsewhere';
      sourceMarketplace: Marketplace;
      sourcePrice: number;
      cheaperMarketplace: Marketplace;
      cheaperPrice: number;
      url: string;
    };

function findCheaperSibling(
  newOffers: MarketplaceOffer[],
  sourceMarketplace: Marketplace,
  sourcePrice: number,
  settings: PriceAlertSettings,
): MarketplaceOffer | null {
  let best: MarketplaceOffer | null = null;
  for (const o of newOffers) {
    if (o.marketplace === sourceMarketplace) continue;
    if (!isAlertableCompareOffer(o)) continue;
    const p = o.price!;
    if (!isSignificantDrop(sourcePrice, p, settings)) continue;
    if (!best || p < (best.price as number)) best = o;
  }
  return best;
}

/**
 * Pure planning of compare alerts (for tests + dispatch).
 * Cross-MP finds win over same-MP source drops when a cheaper sibling exists.
 */
export function planComparePriceAlerts(
  product: CompareProduct,
  newOffers: MarketplaceOffer[],
  settings: PriceAlertSettings,
  options?: { marketplaces?: ComparisonMarketplace[] },
): CompareAlertPlan[] {
  const oldOffers = offersFromCompareProduct(product, {
    marketplaces: options?.marketplaces,
  });
  const sourceMarketplace = product.sourceMarketplace as Marketplace;
  const oldSourcePrice = resolveOldSourcePrice(product, oldOffers);
  const cheaperPlans: CompareAlertPlan[] = [];
  const dropPlans: CompareAlertPlan[] = [];

  // —— 1) Cross-MP: cheaper elsewhere (OLD source price) ——
  // First priced sibling = baseline only (no alert). Alert on later improvement.
  if (oldSourcePrice != null && oldSourcePrice > 0) {
    for (const newOffer of newOffers) {
      if (newOffer.marketplace === sourceMarketplace) continue;
      if (!isAlertableCompareOffer(newOffer)) continue;

      const cheaperPrice = newOffer.price!;
      if (!isSignificantDrop(oldSourcePrice, cheaperPrice, settings)) continue;
      if (isCatastrophicCheaperElsewhere(oldSourcePrice, cheaperPrice, newOffer)) continue;

      const oldOffer = oldOffers.find((o) => o.marketplace === newOffer.marketplace);
      const improvedOnMp =
        isOfferWithPrice(oldOffer) && cheaperPrice < (oldOffer!.price as number);

      // First find on this MP — establish baseline, do not alert
      if (!improvedOnMp) continue;

      if (oldOffer && !isSameBoundProduct(oldOffer, newOffer)) continue;

      // Same-MP drop on that target already covers improved bound card
      if (
        isOfferWithPrice(oldOffer) &&
        isSignificantDrop(oldOffer!.price!, cheaperPrice, settings)
      ) {
        continue;
      }

      cheaperPlans.push({
        kind: 'cheaper_elsewhere',
        sourceMarketplace,
        sourcePrice: oldSourcePrice,
        cheaperMarketplace: newOffer.marketplace as Marketplace,
        cheaperPrice,
        url: newOffer.url,
      });
    }
  }

  const cheaperSibling =
    oldSourcePrice != null && oldSourcePrice > 0
      ? findCheaperSibling(newOffers, sourceMarketplace, oldSourcePrice, settings)
      : null;

  // Fallback: sibling cheaper vs old source but section-1 skipped (e.g. source-slot bleed).
  // Never alert on first sibling find — only improved / bleed after baseline exists.
  if (cheaperSibling && oldSourcePrice != null) {
    if (isCatastrophicCheaperElsewhere(oldSourcePrice, cheaperSibling.price as number, cheaperSibling)) {
      // skip
    } else {
      const already = cheaperPlans.some(
        (p) =>
          p.kind === 'cheaper_elsewhere' &&
          p.cheaperMarketplace === cheaperSibling.marketplace,
      );
      if (!already) {
        const oldOnSibling = oldOffers.find((o) => o.marketplace === cheaperSibling.marketplace);
        const sourceNew = newOffers.find((o) => o.marketplace === sourceMarketplace);
        const sourceBleed =
          isOfferWithPrice(oldOnSibling) &&
          isOfferWithPrice(sourceNew) &&
          pricesNearlyEqual(sourceNew!.price!, cheaperSibling.price as number) &&
          isSignificantDrop(oldSourcePrice, sourceNew!.price!, settings);

        // improved sibling is covered by same-MP compare_price_drop; fallback = bleed only
        if (sourceBleed) {
          cheaperPlans.push({
            kind: 'cheaper_elsewhere',
            sourceMarketplace,
            sourcePrice: oldSourcePrice,
            cheaperMarketplace: cheaperSibling.marketplace as Marketplace,
            cheaperPrice: cheaperSibling.price as number,
            url: cheaperSibling.url,
          });
        }
      }
    }
  }

  const cheaperPrices = new Set(
    cheaperPlans
      .filter(
        (p): p is Extract<CompareAlertPlan, { kind: 'cheaper_elsewhere' }> =>
          p.kind === 'cheaper_elsewhere',
      )
      .map((p) => p.cheaperPrice),
  );

  // —— 2) Same-MP price drop ——
  for (const newOffer of newOffers) {
    if (!isAlertableCompareOffer(newOffer)) continue;

    const oldOffer = oldOffers.find((o) => o.marketplace === newOffer.marketplace);
    if (!isOfferWithPrice(oldOffer)) continue;
    if (!isSameBoundProduct(oldOffer!, newOffer)) continue;

    const previousPrice = oldOffer!.price!;
    const newPrice = newOffer.price!;

    if (newPrice < previousPrice * 0.35 && previousPrice - newPrice > 20_000) {
      continue;
    }

    if (!isSignificantDrop(previousPrice, newPrice, settings)) continue;

    // Never attribute source-MP drop to a price that matches a cheaper sibling (Ozon).
    // Real YM drops to a different price still notify.
    if (newOffer.marketplace === sourceMarketplace && cheaperSibling) {
      if (pricesNearlyEqual(newPrice, cheaperSibling.price as number)) {
        continue;
      }
    }

    if (
      newOffer.marketplace === sourceMarketplace &&
      [...cheaperPrices].some((p) => pricesNearlyEqual(p, newPrice))
    ) {
      continue;
    }

    dropPlans.push({
      kind: 'compare_price_drop',
      marketplace: newOffer.marketplace as Marketplace,
      previousPrice,
      newPrice,
      url: newOffer.url,
    });
  }

  // Dedupe cheaper plans: one per marketplace (keep lowest price)
  const cheaperByMp = new Map<string, CompareAlertPlan>();
  for (const p of cheaperPlans) {
    if (p.kind !== 'cheaper_elsewhere') continue;
    const prev = cheaperByMp.get(p.cheaperMarketplace);
    if (!prev || (prev.kind === 'cheaper_elsewhere' && p.cheaperPrice < prev.cheaperPrice)) {
      cheaperByMp.set(p.cheaperMarketplace, p);
    }
  }

  return [...cheaperByMp.values(), ...dropPlans];
}

export async function checkComparePriceDrops(
  product: CompareProduct,
  newOffers: MarketplaceOffer[],
): Promise<void> {
  const settings = await getPriceAlertSettings();
  if (!settings.notificationsEnabled || !settings.compareAlerts) return;

  // After add: silent baseline for Chrome + Telegram (TG tracked grace is separate)
  if (
    typeof product.addedAt === 'number' &&
    product.addedAt > 0 &&
    Date.now() - product.addedAt < COMPARE_ALERT_GRACE_MS
  ) {
    try {
      console.info('[PriceGuard] compare alerts skipped (grace)', {
        productId: product.id,
        ageMs: Date.now() - product.addedAt,
      });
    } catch {
      // ignore
    }
    return;
  }

  const title = product.title !== 'Товар' ? product.title : 'Товар в сравнении';
  const selected = await getSelectedSearchMarketplaces();
  const plans = planComparePriceAlerts(product, newOffers, settings, {
    marketplaces: selected,
  });

  try {
    console.info('[PriceGuard] compare alerts plan', {
      productId: product.id,
      source: product.sourceMarketplace,
      plans: plans.map((p) =>
        p.kind === 'cheaper_elsewhere'
          ? {
              kind: p.kind,
              from: p.sourceMarketplace,
              to: p.cheaperMarketplace,
              old: p.sourcePrice,
              new: p.cheaperPrice,
              urlHost: (() => {
                try {
                  return new URL(p.url).hostname;
                } catch {
                  return '?';
                }
              })(),
            }
          : {
              kind: p.kind,
              mp: p.marketplace,
              old: p.previousPrice,
              new: p.newPrice,
            },
      ),
    });
  } catch {
    // ignore
  }

  for (const plan of plans) {
    if (plan.kind === 'cheaper_elsewhere') {
      await dispatchCheaperElsewhereAlert({
        productTitle: title,
        sourceMarketplace: plan.sourceMarketplace,
        sourcePrice: plan.sourcePrice,
        cheaperMarketplace: plan.cheaperMarketplace,
        cheaperPrice: plan.cheaperPrice,
        url: plan.url,
      });
    } else {
      await dispatchComparePriceDropAlert(
        title,
        plan.marketplace,
        plan.previousPrice,
        plan.newPrice,
        plan.url,
      );
    }
  }
}
