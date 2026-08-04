import { findActiveProductTab } from '@/lib/active-product-tab';
import {
  setFullAnalysisBusy,
  isFullAnalysisBusy,
  FULL_ANALYSIS_BUSY_MESSAGE,
} from '@/lib/ai-busy-lock';
import { setupProductPageNavigation } from '@/background/product-navigation';
import { resolveProductForTab } from '@/lib/background-product-scrape';
import { checkComparePriceDrops } from '@/lib/compare-price-alerts';
import { agentLog, flushAgentLogs } from '@/lib/debug-log';
import { getCompareProducts, setSelectedCompareId, updateCompareProduct } from '@/lib/comparison-storage';
import { shouldRunCompare } from '@/lib/compare-cache';
import { resolveAndAddCompareProduct, linkMarketplaceOffer, ManualLinkNeedsConfirmError } from '@/lib/compare-resolve';
import { refreshCompareProduct } from '@/lib/compare-service';
import { runCompareJob, isCompareRunning, clearCompareRunning } from '@/lib/compare-jobs';
import { withSendResponse, withSendResponseOk } from '@/lib/with-send-response';
import {
  researchClearAutoOnly,
  clearBoundOffer,
  isResearchPreservedSlot,
  findPendingChoiceForProductUrl,
} from '@/lib/candidate-pool';
import { selectCompareSearchCandidate } from '@/lib/compare-candidate-select';
import { fetchOfferFromUrl } from '@/lib/offer-fetch';
import type { ComparisonMarketplace } from '@/types/comparison';
import { runFullProductAnalysis } from '@/lib/ai/full-analysis';
import { collectReviewsForProduct } from '@/lib/reviews/collect-reviews';
import { withSharedReviewCollect } from '@/lib/reviews/raw-review-cache';
import { rejectAndResearchMarketplace, rejectCompareCandidate } from '@/lib/compare-reject';
import { loadReviewProductFromInput } from '@/lib/reviews/load-review-product';
import {
  getCachedFullAnalysis,
  saveCachedFullAnalysis,
  evaluateLocalFullAnalysisCache,
} from '@/lib/full-analysis-cache';
import { computeCardFingerprint } from '@/lib/card-fingerprint';
import { lookupCrossMarketplaceAiCache } from '@/lib/ai/cache-cross-mp';
import { AI_CACHE_CONFIG, type AiCacheReason } from '@/lib/ai/cache-config';
import {
  computeAiCacheConfidence,
  decideAiCacheReuse,
  featuresFromTitle,
  refineCacheReasonForSource,
} from '@/lib/ai/cache-confidence';
import {
  analysisSingleflightKey,
  withAnalysisSingleflight,
} from '@/lib/analysis-singleflight';
import { pipelineMetrics } from '@/lib/pipeline-metrics';
import { withPriceInsightOverlay } from '@/lib/price-insight-overlay';
import { formatApiErrorForUser } from '@/api/errors';
import { userFacingError } from '@/lib/fetch-retry';
import { offersFromCompareProduct } from '@/lib/compare-offers';
import type { ReviewFilter } from '@/types/review-analysis';
import { dispatchPriceDropAlert, dispatchTargetPriceAlert } from '@/lib/price-alert-dispatch';
import { assertScrapedPriceIdentity } from '@/lib/price-identity';
import { isHiddenBrowserTab } from '@/lib/hidden-browser';
import { ensureSessionId } from '@/lib/telemetry/context';
import { flushRemoteTelemetry } from '@/lib/telemetry/flush';
import { setupNotificationHandlers } from '@/lib/notifications';
import { getAuthSession } from '@/lib/supabase/auth';
import { canUseCloudFeatures } from '@/lib/supabase/auth-guard';
import { ensureTrackedRealtime } from '@/lib/supabase/post-login';
import { areNotificationsEnabledForProduct } from '@/lib/notification-settings';
import {
  getTrackedProducts,
  getTrackedProduct,
  getPriceHistory,
  removeTrackedProduct,
  setTargetPrice,
  updateTrackedProductPrice,
  isTargetPriceReached,
  syncTrackedProductsWithCloud,
} from '@/lib/storage';
import type { CompareProduct } from '@/types/comparison';
import type { FullProductAnalysis } from '@/types/full-analysis';
import type { Product, TrackedProduct } from '@/types/product';
import type { Marketplace } from '@/types/product';
import { minReviewsForFullAnalysis, MIN_REVIEWS_FOR_ANALYSIS } from '@/types/review-analysis';
import { detectComparisonMarketplace } from '@/utils/comparison-url';
import { detectMarketplace, extractArticle } from '@/utils/marketplace';
import { toCanonicalProductUrl } from '@/utils/product-url';
import { fetchWildberriesProduct } from '@/utils/parsers/wb-api';
import { logAuthenticityCheck } from '@/lib/authenticity/supabase-log';
import {
  isServerPriceMonitoringActive,
} from '@/lib/supabase/alert-settings-sync';
import {
  getRemoteFullProductCache,
  putRemoteFullProductCache,
  remoteCacheMatchesReviews,
} from '@/lib/supabase/product-cache';
import { analyzeViaProductIntel } from '@/lib/supabase/product-intel';
import {
  canRunFullAnalysis,
  recordFullAnalysis,
  isPremium,
} from '@/lib/subscription';
import {
  deriveFullAnalysisQuotaIntent,
  shouldConsumeFullAnalysisQuota,
} from '@/lib/ai/full-analysis-quota-policy';
import { setFullAnalysisJobSnapshot } from '@/lib/ai/full-analysis-job';
import '@/lib/supabase/price-cache';
import '@/lib/supabase/compare-sync';
import {
  flushPendingSync,
  schedulePendingSyncAlarm,
  PENDING_SYNC_ALARM,
} from '@/lib/pending-sync';

const ALARM_NAME = 'priceguard-price-check';
const STARTUP_CHECK_KEY = 'priceguard_last_startup_check';
/** Как Palert: проверка каждые 6 часов */
const CHECK_INTERVAL_MINUTES = 6 * 60;
const STARTUP_CHECK_COOLDOWN_MS = 2 * 60 * 60 * 1000;

void schedulePendingSyncAlarm();

/** Soft safety net: log unhandled rejections without PII (does not replace sendResponse). */
self.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason;
  const msg =
    reason instanceof Error
      ? reason.message.slice(0, 200)
      : typeof reason === 'string'
        ? reason.slice(0, 200)
        : 'non_error_rejection';
  console.warn('[PriceGuard] unhandledrejection', msg);
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function checkTrackedProduct(product: TrackedProduct): Promise<void> {
  const marketplace = detectComparisonMarketplace(product.url) ?? detectMarketplace(product.url);
  if (!marketplace) return;

  const pageUrl = toCanonicalProductUrl(product.url, product.marketplace);
  const mp = (detectComparisonMarketplace(product.url) ?? product.marketplace) as ComparisonMarketplace;

  try {
    let offer = await fetchOfferFromUrl(pageUrl, mp);
    let imageUrlAlternatives = product.imageUrlAlternatives;

    if ((!offer?.price || offer.price <= 0) && product.marketplace === 'wildberries') {
      const article = product.article || extractArticle(pageUrl, 'wildberries');
      if (article) {
        const api = await fetchWildberriesProduct(article);
        if (api?.price) {
          offer = {
            marketplace: 'wildberries',
            title: api.title,
            price: api.price,
            oldPrice: api.oldPrice,
            delivery: api.delivery ?? null,
            rating: api.reviewRating ?? null,
            reviewCount: api.feedbacks,
            url: pageUrl,
            imageUrl: api.imageUrl,
            found: true,
          };
          imageUrlAlternatives = api.imageUrlAlternatives?.length
            ? api.imageUrlAlternatives
            : imageUrlAlternatives;
        }
      }
    }

    if (!offer?.price || offer.price <= 0) {
      console.warn(`[PriceGuard] Не удалось получить цену: ${product.title}`);
      return;
    }

    const offerUrl = offer.url || pageUrl;
    const identity = assertScrapedPriceIdentity(product, {
      marketplace: product.marketplace,
      article: extractArticle(offerUrl, product.marketplace) || product.article,
      url: offerUrl,
      id: product.id,
      title: offer.title || product.title,
    });
    if (!identity.ok) {
      return;
    }

    const updated: Product = {
      ...product,
      url: pageUrl,
      title: product.title,
      article: identity.article || product.article,
      price: offer.price,
      oldPrice: offer.oldPrice ?? product.oldPrice,
      imageUrl: offer.imageUrl || product.imageUrl,
      imageUrlAlternatives,
      scrapedAt: Date.now(),
    };

    const priceChange = await updateTrackedProductPrice(updated);
    const canNotify = await areNotificationsEnabledForProduct(product.id);

    if (priceChange?.dropped && canNotify) {
      await dispatchPriceDropAlert(updated, priceChange.previousPrice);
    }

    const freshTracked = await getTrackedProduct(product.id);
    if (canNotify && freshTracked && isTargetPriceReached(freshTracked, offer.price)) {
      await dispatchTargetPriceAlert(updated, freshTracked.targetPrice!);
    }
  } catch (error) {
    console.warn(`[PriceGuard] Ошибка проверки ${product.url}:`, error);
  }
}

/** Если серверный cron не обновил цену дольше этого — клиентский backup */
const SERVER_STALE_MS = 8 * 60 * 60 * 1000;

function isTrackedPriceStale(product: TrackedProduct, now = Date.now()): boolean {
  const checkedAt = product.scrapedAt;
  if (!checkedAt || !Number.isFinite(checkedAt) || checkedAt <= 0) return true;
  return now - checkedAt >= SERVER_STALE_MS;
}

export async function checkAllTrackedPrices(options?: { force?: boolean }): Promise<void> {
  const tracked = await getTrackedProducts();
  if (tracked.length === 0) return;

  // При server_monitoring cron — основной путь; клиент — backup для устаревших
  // (Ozon/YM antibot на Edge). force=true — полная ручная проверка.
  let toCheck = tracked;
  if (!options?.force && (await isServerPriceMonitoringActive())) {
    toCheck = tracked.filter((p) => isTrackedPriceStale(p));
    if (toCheck.length === 0) {
      console.info(
        '[PriceGuard AI] Серверный мониторинг активен — все цены свежие, клиентский backup не нужен',
      );
      return;
    }
    console.info(
      `[PriceGuard AI] Серверный мониторинг: клиентский backup для ${toCheck.length}/${tracked.length} устаревших`,
    );
  } else {
    console.info(`[PriceGuard AI] Фоновая проверка: ${toCheck.length} товаров`);
  }

  for (const product of toCheck) {
    await checkTrackedProduct(product);
    await delay(2_000);
  }
}

async function checkAllComparePrices(options?: { force?: boolean }): Promise<void> {
  let products = await getCompareProducts();
  if (!products.length) return;

  // Server cron is primary; client only refreshes stale bound cards (no SERP / Scrappey).
  const skipUnlocker = !options?.force;
  if (!options?.force && (await isServerPriceMonitoringActive())) {
    products = products.filter((p) => {
      const at = p.comparedAt;
      if (!at || !Number.isFinite(at) || at <= 0) return true;
      return Date.now() - at >= SERVER_STALE_MS;
    });
    if (!products.length) {
      console.info(
        '[PriceGuard AI] Серверный мониторинг активен — compare цены свежие, клиентский backup не нужен',
      );
      return;
    }
    console.info(
      `[PriceGuard AI] Серверный мониторинг: compare backup для ${products.length} устаревших`,
    );
  }

  for (const product of products) {
    try {
      // Don't race a live research/refresh job — it may have just written needs_choice
      if (await isCompareRunning(product.id)) continue;

      const result = await refreshCompareProduct(product, options?.force ?? false, {
        mode: 'refresh',
        skipUnlocker,
      });
      await checkComparePriceDrops(product, result.offers);
    } catch (error) {
      console.warn('[PriceGuard] compare price check:', error);
    }
    await delay(2_000);
  }
}

/** Singleflight: alarm + startup + CHECK_PRICES_NOW не гоняют параллельные полные прогоны. */
let periodicCheckInFlight: Promise<void> | null = null;
let compareRefreshInFlight: Promise<void> | null = null;
/** Если во время прогона пришёл force — после текущего прогона один follow-up. */
let periodicCheckForceQueued = false;

async function runPeriodicPriceChecks(options?: { force?: boolean }): Promise<void> {
  if (periodicCheckInFlight) {
    if (options?.force) periodicCheckForceQueued = true;
    await periodicCheckInFlight;
    if (periodicCheckInFlight) await periodicCheckInFlight;
    return;
  }

  const runOnce = async (force?: boolean): Promise<void> => {
    await checkAllTrackedPrices({ force });
    await checkAllComparePrices({ force });
  };

  periodicCheckInFlight = (async () => {
    await runOnce(options?.force);
    while (periodicCheckForceQueued) {
      periodicCheckForceQueued = false;
      await runOnce(true);
    }
  })().finally(() => {
    periodicCheckInFlight = null;
  });
  await periodicCheckInFlight;
}

async function runCompareRefreshAll(options?: { force?: boolean }): Promise<void> {
  if (compareRefreshInFlight) {
    await compareRefreshInFlight;
    return;
  }
  compareRefreshInFlight = checkAllComparePrices(options).finally(() => {
    compareRefreshInFlight = null;
  });
  await compareRefreshInFlight;
}

async function shouldRunStartupCheck(): Promise<boolean> {
  const result = await chrome.storage.local.get(STARTUP_CHECK_KEY);
  const lastCheck = result[STARTUP_CHECK_KEY] as number | undefined;
  if (!lastCheck) return true;
  return Date.now() - lastCheck >= STARTUP_CHECK_COOLDOWN_MS;
}

async function markStartupCheck(): Promise<void> {
  await chrome.storage.local.set({ [STARTUP_CHECK_KEY]: Date.now() });
}

export async function runStartupPriceCheck(): Promise<void> {
  const tracked = await getTrackedProducts();
  const compare = await getCompareProducts();
  if (tracked.length === 0 && compare.length === 0) return;

  if (!(await shouldRunStartupCheck())) {
    console.info('[PriceGuard AI] Пропуск проверки при старте (cooldown)');
    return;
  }

  await markStartupCheck();
  await runPeriodicPriceChecks();
}

function schedulePriceChecks(): void {
  chrome.alarms.create(ALARM_NAME, {
    delayInMinutes: CHECK_INTERVAL_MINUTES,
    periodInMinutes: CHECK_INTERVAL_MINUTES,
  });
}

setupProductPageNavigation();

/** Синхронизация с облаком только для авторизованных пользователей */
async function syncCloudIfAuthed(): Promise<void> {
  try {
    if (!(await canUseCloudFeatures())) return;
    await syncTrackedProductsWithCloud();
    await ensureTrackedRealtime();
  } catch (error) {
    console.warn('[PriceGuard AI] Cloud sync at startup failed:', error);
  }
}

const UPDATE_SYNC_HINT_KEY = 'priceguard_update_sync_hint';

chrome.runtime.onInstalled.addListener((details) => {
  console.info('[PriceGuard] SW ready', chrome.runtime.getManifest().version);
  console.info('[PriceGuard AI] Extension installed', details.reason);
  void ensureSessionId();
  setupNotificationHandlers();
  setupProductPageNavigation();
  schedulePriceChecks();
  void runStartupPriceCheck();
  void syncCloudIfAuthed();
  void flushRemoteTelemetry();
  if (details.reason === 'update') {
    void chrome.storage.local.set({ [UPDATE_SYNC_HINT_KEY]: true });
  }
});

chrome.runtime.onStartup.addListener(() => {
  console.info('[PriceGuard] SW ready', chrome.runtime.getManifest().version);
  void ensureSessionId();
  setupNotificationHandlers();
  setupProductPageNavigation();
  schedulePriceChecks();
  void runStartupPriceCheck();
  void syncCloudIfAuthed();
  void flushRemoteTelemetry();
});

// Cold start / reload (onInstalled may not fire)
console.info('[PriceGuard] SW ready', chrome.runtime.getManifest().version);
void ensureSessionId();

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    void runPeriodicPriceChecks();
  }
  if (alarm.name === PENDING_SYNC_ALARM) {
    void flushPendingSync();
    void flushRemoteTelemetry();
  }
});

void flushPendingSync();
void flushRemoteTelemetry();

void getAuthSession().then((session) => {
  if (session) {
    void syncCloudIfAuthed();
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'GET_ACTIVE_TAB_PRODUCT') {
    return withSendResponse(sendResponse, async (respond) => {
      const tab = await findActiveProductTab();
      agentLog(
        'background/index.ts:GET_ACTIVE_TAB_PRODUCT',
        'resolved product tab',
        { tabId: tab?.id ?? null, url: tab?.url?.slice(0, 120) ?? null },
        'B',
      );

      const result = tab
        ? await resolveProductForTab(tab)
        : { ok: false, error: 'Активная вкладка не найдена' };

      agentLog(
        'background/index.ts:GET_ACTIVE_TAB_PRODUCT:result',
        'product resolve result',
        {
          ok: result.ok,
          source: result.source ?? null,
          hasProduct: !!result.product,
          error: result.error ?? null,
        },
        'B',
      );

      respond(result);
    });
  }

  if (message.type === 'DUMP_AGENT_LOGS') {
    return withSendResponseOk(sendResponse, async () => {
      const count = await flushAgentLogs();
      return { count };
    });
  }

  if (message.type === 'IS_HIDDEN_BROWSER_CONTEXT') {
    const tabId = _sender.tab?.id;
    const windowId = _sender.tab?.windowId;
    const hidden = isHiddenBrowserTab(tabId, windowId);
    sendResponse({ ok: true, hidden });
    return true;
  }

  if (message.type === 'PRODUCT_SCRAPED') {
    const tabId = _sender.tab?.id;
    const windowId = _sender.tab?.windowId;
    if (isHiddenBrowserTab(tabId, windowId)) {
      sendResponse({ ok: true, ignored: true });
      return true;
    }
    const product = message.payload as Product;
    chrome.action.setBadgeText({ text: '●' });
    chrome.action.setBadgeBackgroundColor({ color: '#16a34a' });
    chrome.storage.local.set({ priceguard_badge_product: product.id });
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === 'PRICE_DROP') {
    const tabId = _sender.tab?.id;
    const windowId = _sender.tab?.windowId;
    if (isHiddenBrowserTab(tabId, windowId)) {
      sendResponse({ ok: true, ignored: true });
      return true;
    }
    const { product, previousPrice } = message.payload as {
      product: Product;
      previousPrice: number;
    };

    void (async () => {
      await dispatchPriceDropAlert(product, previousPrice);
    })();

    sendResponse({ ok: true });
    return true;
  }

  if (message.type === 'CHECK_PRICES_NOW') {
    return withSendResponseOk(sendResponse, async () => {
      await runPeriodicPriceChecks({ force: true });
    });
  }

  if (message.type === 'REFRESH_ALL_COMPARE_PRICES') {
    return withSendResponseOk(sendResponse, async () => {
      await runCompareRefreshAll({ force: true });
    });
  }

  if (message.type === 'UNTRACK_PRODUCT') {
    const { productId } = message.payload as { productId: string };
    return withSendResponseOk(sendResponse, async () => {
      await removeTrackedProduct(productId);
    });
  }

  if (message.type === 'SET_TARGET_PRICE') {
    const { productId, targetPrice } = message.payload as {
      productId: string;
      targetPrice: number;
    };
    return withSendResponseOk(sendResponse, async () => {
      await setTargetPrice(productId, targetPrice);
    });
  }

  if (message.type === 'ENSURE_COMPARE_PRODUCT') {
    const { url, article, title, price, oldPrice, forceCompare, authenticity } = message.payload as {
      url: string;
      article?: string;
      title?: string;
      price?: number;
      oldPrice?: number;
      forceCompare?: boolean;
      authenticity?: import('@/types/authenticity').ProductAuthenticity;
    };

    const safeRespond = (payload: object) => {
      try {
        sendResponse(payload);
      } catch {
        // popup уже закрыт — товар сохранён в storage
      }
    };

    void (async () => {
      if (await isFullAnalysisBusy()) {
        safeRespond({ ok: false, error: FULL_ANALYSIS_BUSY_MESSAGE });
        return;
      }

      let savedProductId: string | null = null;

      try {
        // Candidate card opened while picker is open → select that candidate on the
        // existing row. Do NOT resolveAndAdd (new shell) or researchClearAutoOnly
        // (would wipe needs_choice / searchCandidates).
        const pendingChoice = findPendingChoiceForProductUrl(await getCompareProducts(), url);
        if (pendingChoice) {
          try {
            const selected = await selectCompareSearchCandidate(
              pendingChoice.product.id,
              pendingChoice.marketplace,
              url,
            );
            savedProductId = selected.id;
            await setSelectedCompareId(selected.id);
            safeRespond({
              ok: true,
              productId: selected.id,
              started: false,
              fromCache: true,
              selectedCandidate: true,
            });
            return;
          } catch (selectErr) {
            console.warn('[PriceGuard] ENSURE pending-choice select failed:', selectErr);
            // Fall through to normal resolve; preserve picker on research clear below
          }
        }

        const product = await resolveAndAddCompareProduct(url, article, {
          title,
          price,
          oldPrice,
          authenticity,
        });
        savedProductId = product.id;

        if (authenticity) {
          void logAuthenticityCheck({
            marketplace: product.sourceMarketplace,
            article: product.article,
            status: authenticity.status,
            source: 'compare',
          });
        }

        await setSelectedCompareId(product.id);

        const willCompare = shouldRunCompare(product, forceCompare);

        safeRespond({
          ok: true,
          productId: product.id,
          started: willCompare,
          fromCache: !willCompare,
        });

        if (willCompare) {
          await clearCompareRunning();
          // Soft ENSURE / duplicate merge: keep open needs_choice pickers.
          // Full wipe only via RESEARCH_COMPARE_PRODUCT / RESEARCH_SINGLE_MARKETPLACE.
          const cleared = researchClearAutoOnly(product, { preservePendingChoice: true });
          await updateCompareProduct(cleared);
          void runCompareJob(cleared, true, 'research');
        }
      } catch (error) {
        if (savedProductId) {
          safeRespond({ ok: true, productId: savedProductId, started: true, recovered: true });
          return;
        }
        safeRespond({
          ok: false,
          error: userFacingError(error, 'Не удалось добавить в «Мои товары»'),
        });
      }
    })();

    return true;
  }

  if (message.type === 'LINK_MARKETPLACE_OFFER') {
    const { productId, marketplace, url, confirmed } = message.payload as {
      productId: string;
      marketplace: import('@/types/comparison').ComparisonMarketplace;
      url: string;
      confirmed?: boolean;
    };

    void (async () => {
      try {
        const product = await linkMarketplaceOffer(productId, marketplace, url, { confirmed });
        sendResponse({ ok: true, product });
      } catch (error) {
        if (error instanceof ManualLinkNeedsConfirmError) {
          sendResponse({
            ok: false,
            needsConfirm: true,
            error: error.message,
            referenceTitle: error.referenceTitle,
            fetchedTitle: error.fetchedTitle,
            confidence: error.confidence,
          });
          return;
        }
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : 'Не удалось привязать ссылку',
        });
      }
    })();

    return true;
  }

  if (message.type === 'SELECT_COMPARE_CANDIDATE') {
    const { productId, marketplace, url, title, price, rating } = message.payload as {
      productId: string;
      marketplace: import('@/types/comparison').ComparisonMarketplace;
      url: string;
      title?: string;
      price?: number | null;
      rating?: number | null;
    };

    void (async () => {
      try {
        const product = await selectCompareSearchCandidate(productId, marketplace, url, {
          title,
          price,
          rating,
        });
        sendResponse({ ok: true, product });
      } catch (error) {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : 'Не удалось выбрать товар',
        });
      }
    })();

    return true;
  }

  if (message.type === 'COMPARE_PRICES') {
    const payload = message.payload as
      | CompareProduct
      | { product: CompareProduct; force?: boolean; mode?: 'refresh' | 'research' };

    return withSendResponse(sendResponse, async (respond) => {
      const product =
        'sourceUrl' in payload && payload.sourceUrl
          ? (payload as CompareProduct)
          : (payload as { product: CompareProduct }).product;

      const force =
        'force' in payload && typeof (payload as { force?: boolean }).force === 'boolean'
          ? (payload as { force?: boolean }).force
          : false;

      const mode =
        'mode' in payload &&
        ((payload as { mode?: string }).mode === 'refresh' ||
          (payload as { mode?: string }).mode === 'research')
          ? (payload as { mode: 'refresh' | 'research' }).mode
          : 'refresh';

      if (!product?.sourceUrl) {
        respond({ ok: false, error: 'Товар не выбран' });
        return;
      }

      if (!force && (await isCompareRunning(product.id))) {
        respond({ ok: true, started: false, alreadyRunning: true, productId: product.id });
        return;
      }

      void runCompareJob(product, force, mode);
      respond({ ok: true, started: true, productId: product.id });
    });
  }

  if (message.type === 'RESEARCH_COMPARE_PRODUCT') {
    const { productId } = message.payload as { productId: string };

    void (async () => {
      try {
        const products = await getCompareProducts();
        const product = products.find((p) => p.id === productId);
        if (!product) {
          sendResponse({ ok: false, error: 'Товар не найден' });
          return;
        }
        // Ack immediately — MV3 closes the message channel if we await storage first
        sendResponse({ ok: true, started: true, productId: product.id });

        void (async () => {
          try {
            await clearCompareRunning();
            const cleared = researchClearAutoOnly(product);
            await updateCompareProduct(cleared);
            void runCompareJob(cleared, true, 'research');
          } catch (error) {
            console.warn('[PriceGuard] RESEARCH_COMPARE_PRODUCT job start:', error);
          }
        })();
      } catch (error) {
        sendResponse({
          ok: false,
          error: formatApiErrorForUser(error, 'Не удалось запустить поиск'),
        });
      }
    })();

    return true;
  }

  if (message.type === 'RESEARCH_SINGLE_MARKETPLACE') {
    const { productId, marketplace } = message.payload as {
      productId: string;
      marketplace: import('@/types/comparison').ComparisonMarketplace;
    };

    void (async () => {
      try {
        const products = await getCompareProducts();
        const product = products.find((p) => p.id === productId);
        if (!product) {
          sendResponse({ ok: false, error: 'Товар не найден' });
          return;
        }
        if (!marketplace || marketplace === product.sourceMarketplace) {
          sendResponse({ ok: false, error: 'Некорректная площадка' });
          return;
        }

        sendResponse({ ok: true, started: true, productId: product.id, marketplace });

        void (async () => {
          try {
            await clearCompareRunning();
            const cleared = isResearchPreservedSlot(product, marketplace)
              ? product
              : clearBoundOffer(product, marketplace, { clearPool: true });
            await updateCompareProduct(cleared);
            void runCompareJob(cleared, true, 'research', {
              onlyMarketplaces: [marketplace],
            });
          } catch (error) {
            console.warn('[PriceGuard] RESEARCH_SINGLE_MARKETPLACE job start:', error);
          }
        })();
      } catch (error) {
        sendResponse({
          ok: false,
          error: formatApiErrorForUser(error, 'Не удалось запустить поиск'),
        });
      }
    })();

    return true;
  }

  if (message.type === 'REJECT_COMPARE_OFFER') {
    const { productId, marketplace, rejectedUrl } = message.payload as {
      productId: string;
      marketplace: import('@/types/comparison').ComparisonMarketplace;
      rejectedUrl: string;
    };

    void (async () => {
      try {
        const { product, offer } = await rejectAndResearchMarketplace(
          productId,
          marketplace,
          rejectedUrl,
        );
        sendResponse({ ok: true, product, offer });
      } catch (error) {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : 'Не удалось найти другой товар',
        });
      }
    })();

    return true;
  }

  if (message.type === 'REJECT_COMPARE_CANDIDATE') {
    const { productId, marketplace, rejectedUrl } = message.payload as {
      productId: string;
      marketplace: import('@/types/comparison').ComparisonMarketplace;
      rejectedUrl: string;
    };

    void (async () => {
      try {
        const { product, offer } = await rejectCompareCandidate(
          productId,
          marketplace,
          rejectedUrl,
        );
        sendResponse({ ok: true, product, offer });
      } catch (error) {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : 'Не удалось отклонить вариант',
        });
      }
    })();

    return true;
  }

  if (message.type === 'LOAD_REVIEW_PRODUCT') {
    const { input } = message.payload as { input: string };

    void (async () => {
      try {
        const product = await loadReviewProductFromInput(input);
        sendResponse({ ok: true, product });
      } catch (error) {
        sendResponse({
          ok: false,
          error:
            error instanceof Error
              ? error.message
              : 'Не удалось загрузить товар',
        });
      }
    })();

    return true;
  }

  if (message.type === 'PREVIEW_REVIEWS') {
    const { productUrl, marketplace, article, filter } = message.payload as {
      productUrl: string;
      marketplace: Marketplace;
      article?: string;
      filter?: ReviewFilter;
    };

    void (async () => {
      try {
        const collected = await withSharedReviewCollect(marketplace, productUrl, () =>
          collectReviewsForProduct({
            productUrl,
            marketplace,
            article,
            filter: filter ?? 'all',
            preferActiveTab: true,
            preferCurrentPage: true,
            previewOnly: true,
            allowNavigation: false,
            skipWhileCompareRunning: true,
          }),
        );

        sendResponse({
          ok: true,
          previewItems: collected.previewItems,
          totalFound: collected.totalFound,
          reviewCount: collected.reviews.length,
          reviewRatings: collected.reviewRatings ?? [],
          insufficient: collected.insufficient,
          source: collected.source,
        });
      } catch (error) {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : 'Не удалось загрузить превью отзывов',
        });
      }
    })();

    return true;
  }

  if (message.type === 'FULL_PRODUCT_ANALYSIS') {
    const {
      productTitle,
      productPrice,
      oldPrice,
      marketplace,
      article,
      productId,
      productUrl,
      forceRefresh,
      softRefresh,
      forceHardRefresh,
      webResearch,
    } = message.payload as {
      productTitle: string;
      productPrice: number;
      oldPrice?: number;
      marketplace: string;
      article: string;
      productId: string;
      productUrl: string;
      forceRefresh?: boolean;
      /** Soft: price overlay / AI без сброса Sonar */
      softRefresh?: boolean;
      /** Жёсткий refresh: сбрасывает и Sonar web-research (только при deep) */
      forceHardRefresh?: boolean;
      /** Deep pipeline Sonar→GPT (Premium UI «Глубокий разбор») */
      webResearch?: boolean;
    };

    void (async () => {
      let locked = false;
      const intent = deriveFullAnalysisQuotaIntent({
        softRefresh,
        forceRefresh,
        forceHardRefresh,
      });

      const applyQuotaAndJob = async (
        flightKey: string,
        productId: string,
        productUrl: string,
        raw: {
          ok: boolean;
          analysis?: FullProductAnalysis;
          fromCache?: boolean;
          analysisSource?: string;
          cacheNote?: string;
          cacheReason?: AiCacheReason | string;
          cacheConfidence?: number;
          error?: string;
        },
      ) => {
        const hasAnalysis = Boolean(raw.ok && raw.analysis);
        let quotaConsumed = false;
        if (
          shouldConsumeFullAnalysisQuota({
            intent,
            ok: Boolean(raw.ok),
            hasAnalysis,
          })
        ) {
          await recordFullAnalysis();
          quotaConsumed = true;
        }

        await setFullAnalysisJobSnapshot({
          flightKey,
          productId,
          productUrl,
          intent,
          status: raw.ok && hasAnalysis ? 'done' : 'error',
          startedAt: Date.now(),
          finishedAt: Date.now(),
          analysis: raw.analysis,
          fromCache: raw.fromCache,
          quotaConsumed,
          cacheNote: raw.cacheNote ?? null,
          cacheReason: raw.cacheReason ?? null,
          cacheConfidence: raw.cacheConfidence ?? null,
          analysisSource: raw.analysisSource,
          error: raw.error,
        });

        return { ...raw, quotaConsumed };
      };

      try {
        const mp = (marketplace as Marketplace | undefined) ?? detectMarketplace(productUrl);
        const canonicalUrl = toCanonicalProductUrl(productUrl, mp ?? undefined);
        const resolvedArticle =
          article?.trim() || (mp ? extractArticle(canonicalUrl, mp) : '') || undefined;

        if (!mp) {
          sendResponse({ ok: false, error: 'Не удалось определить площадку товара' });
          return;
        }

        const flightKey = analysisSingleflightKey({
          marketplace: mp,
          productId,
          url: canonicalUrl,
        });

        await setFullAnalysisJobSnapshot({
          flightKey,
          productId,
          productUrl: canonicalUrl,
          intent,
          status: 'running',
          startedAt: Date.now(),
        });

        const result = await withAnalysisSingleflight(flightKey, async () => {
          locked = true;
          await setFullAnalysisBusy(true);

          const inner = await (async () => {
          const cardFp = computeCardFingerprint(productTitle, undefined, resolvedArticle);
          const cacheRef = { url: productUrl, marketplace, article, id: productId };
          const cached = await getCachedFullAnalysis(cacheRef);

          const priceHistory = await getPriceHistory(productId);
          const historyFormatted = priceHistory.map((p) => ({
            price: p.price,
            date: new Date(p.timestamp).toLocaleDateString('ru-RU'),
          }));

          const compareProducts = await getCompareProducts();
          const compareProduct = compareProducts.find(
            (p) => p.sourceUrl === productUrl || p.article === article,
          );
          const compareOffers = compareProduct
            ? offersFromCompareProduct(compareProduct).map((o) => ({
                marketplace: o.marketplace,
                price: o.price,
                rating: o.rating,
                title: o.title ?? productTitle,
              }))
            : undefined;

          const overlayInput = {
            productPrice,
            oldPrice,
            priceHistory: historyFormatted,
            compareOffers,
          };

          const skipStaticCache = Boolean(forceRefresh || forceHardRefresh);
          const wantDeep = Boolean(webResearch);
          const currentFeatures = featuresFromTitle(productTitle);

          // Soft refresh: overlay цены без AI
          if (softRefresh && !skipStaticCache && cached?.result) {
            const softDec = evaluateLocalFullAnalysisCache({
              cached,
              reviews: [],
              softRefresh: true,
              currentTitle: productTitle,
              currentArticle: resolvedArticle,
              currentPrice: productPrice,
              sameSku: true,
            });
            if (softDec.reuse) {
              void pipelineMetrics.aiCacheLocalHit();
              return {
                ok: true as const,
                analysis: withPriceInsightOverlay(cached.result, overlayInput),
                fromCache: true,
                analysisSource: 'cache' as const,
                cacheReason: 'SOFT_REFRESH' as AiCacheReason,
                cacheConfidence: softDec.score,
                cacheNote: 'Обновлены цена и сравнение — AI-текст без изменений.',
              };
            }
          }

          // SAME_SKU remote lookup (no reviews) — not for deep
          if (
            !skipStaticCache &&
            !wantDeep &&
            AI_CACHE_CONFIG.allowRemoteLookupWithoutReviews &&
            mp &&
            productId
          ) {
            const viaIntel = await analyzeViaProductIntel({
              url: canonicalUrl,
              marketplace: mp,
              productId,
              productUrl: canonicalUrl,
              action: 'lookup',
              allowGenerate: false,
            });
            if (viaIntel?.analysis) {
              const decided = decideAiCacheReuse({
                sameSku: true,
                confidence: 90,
                fresh: true,
                reviewsHashMatch: false,
              });
              if (decided.reuse) {
                const overlaid = withPriceInsightOverlay(viaIntel.analysis, overlayInput);
                await saveCachedFullAnalysis(cacheRef, overlaid, [], cardFp, productPrice, {
                  features: currentFeatures,
                  productTitle,
                  article: resolvedArticle,
                });
                void pipelineMetrics.aiCacheRemoteHit();
                return {
                  ok: true as const,
                  analysis: overlaid,
                  fromCache: true,
                  analysisSource: 'remote_cache' as const,
                  cacheReason: refineCacheReasonForSource('SAME_SKU', 'remote'),
                  cacheConfidence: decided.score,
                  cacheNote: 'Из общего AI Cache (тот же SKU).',
                };
              }
            }
          }

          // CROSS_MARKETPLACE via mapping (lite only; no Sonar)
          if (!skipStaticCache && !wantDeep && mp && productId) {
            const cross = await lookupCrossMarketplaceAiCache({
              marketplace: mp,
              productId,
              productTitle,
              article: resolvedArticle,
            });
            if (cross) {
              const overlaid = withPriceInsightOverlay(cross.analysis, overlayInput);
              await saveCachedFullAnalysis(cacheRef, overlaid, [], cardFp, productPrice, {
                features: currentFeatures,
                productTitle,
                article: resolvedArticle,
              });
              void pipelineMetrics.aiCacheRemoteHit();
              return {
                ok: true as const,
                analysis: overlaid,
                fromCache: true,
                analysisSource: 'remote_cache' as const,
                cacheReason: 'CROSS_MARKETPLACE' as AiCacheReason,
                cacheConfidence: cross.cacheConfidence,
                cacheNote: 'Кэш с другой площадки (подтверждённый mapping).',
              };
            }
          }

          const collected = await withSharedReviewCollect(mp, canonicalUrl, () =>
            collectReviewsForProduct({
              productUrl: canonicalUrl,
              marketplace: mp,
              article: resolvedArticle,
              filter: 'all',
              preferActiveTab: true,
              preferCurrentPage: true,
            }),
          );
          let reviews = collected.reviews;
          let totalFound = collected.totalFound;

          const premium = await isPremium();
          const minReviews = minReviewsForFullAnalysis(premium);

          // Free: отзывы с карточки могут ещё грузиться — короткий retry перед gate
          if (!premium && reviews.length < minReviews) {
            for (let attempt = 0; attempt < 2 && reviews.length < minReviews; attempt++) {
              await new Promise((r) => setTimeout(r, 700 + attempt * 500));
              const retry = await collectReviewsForProduct({
                productUrl: canonicalUrl,
                marketplace: mp,
                article: resolvedArticle,
                filter: 'all',
                preferActiveTab: true,
                preferCurrentPage: true,
                skipWhileCompareRunning: false,
              });
              if (retry.reviews.length > reviews.length) {
                reviews = retry.reviews;
                totalFound = Math.max(totalFound, retry.totalFound);
              }
            }
          }

          if (reviews.length < minReviews) {
            return {
              ok: false as const,
              error:
                minReviews === 0
                  ? `Недостаточно отзывов (${reviews.length}). Откройте карточку товара и повторите.`
                  : `Недостаточно отзывов (${reviews.length}). Нужно минимум ${MIN_REVIEWS_FOR_ANALYSIS}. Откройте карточку товара и повторите.`,
            };
          }

          // product-intel generate (lite only)
          if (!wantDeep) {
            const viaIntel = await analyzeViaProductIntel({
              url: canonicalUrl,
              marketplace: mp,
              productId,
              productUrl: canonicalUrl,
              reviews,
              allowGenerate: true,
            });
            if (viaIntel?.analysis && viaIntel.card.analysisStatus === 'ready') {
              const overlaid = withPriceInsightOverlay(viaIntel.analysis, overlayInput);
              await saveCachedFullAnalysis(cacheRef, overlaid, reviews, cardFp, productPrice, {
                features: currentFeatures,
                productTitle,
                article: resolvedArticle,
              });
              return {
                ok: true as const,
                analysis: overlaid,
                fromCache: viaIntel.card.fromCache,
                analysisSource: 'cloud' as const,
                cacheReason: (viaIntel.card.fromCache
                  ? refineCacheReasonForSource('SAME_SKU', 'remote')
                  : 'NEW_ANALYSIS') as AiCacheReason,
                cacheConfidence: viaIntel.card.fromCache ? 90 : 100,
                cacheNote: viaIntel.card.fromCache
                  ? 'Из общего AI Cache (product-intel).'
                  : 'Анализ через product-intel (отзывы из расширения).',
              };
            }
          }

          // Local confidence gate
          if (!skipStaticCache && cached?.result) {
            const localDec = evaluateLocalFullAnalysisCache({
              cached,
              reviews,
              softRefresh: Boolean(softRefresh),
              forceRefresh: false,
              currentTitle: productTitle,
              currentArticle: resolvedArticle,
              currentPrice: productPrice,
              sameSku: true,
            });
            if (localDec.reuse) {
              void pipelineMetrics.aiCacheLocalHit();
              return {
                ok: true as const,
                analysis: withPriceInsightOverlay(cached.result, overlayInput),
                fromCache: true,
                analysisSource: 'cache' as const,
                cacheReason: localDec.cacheReason,
                cacheConfidence: localDec.score,
                cacheNote:
                  localDec.cacheReason === 'SOFT_REFRESH'
                    ? 'Обновлены цена и сравнение — AI-текст без изменений.'
                    : undefined,
              };
            }
          }

          const fullAccess = await canRunFullAnalysis();
          if (!fullAccess.allowed) {
            return { ok: false as const, error: fullAccess.reason ?? 'Недоступно' };
          }

          let remoteCachedAnalysis: FullProductAnalysis | null = null;
          if (mp && productId && !skipStaticCache && !wantDeep) {
            const remote = await getRemoteFullProductCache(mp, productId);
            if (remote?.fresh && remote.aiAnalysis && remoteCacheMatchesReviews(remote.rawReviews, reviews)) {
              const cachedFeat = featuresFromTitle(remote.productTitle || productTitle);
              const conf = computeAiCacheConfidence(currentFeatures, cachedFeat, {
                article: resolvedArticle,
                cachedArticle: productId,
              });
              const decided = decideAiCacheReuse({
                sameSku: true,
                reviewsHashMatch: true,
                confidence: conf.score,
                hardReject: conf.hardReject,
                fresh: true,
              });
              if (decided.reuse) {
                remoteCachedAnalysis = remote.aiAnalysis;
                const overlaid = withPriceInsightOverlay(remote.aiAnalysis, overlayInput);
                await saveCachedFullAnalysis(cacheRef, overlaid, reviews, cardFp, productPrice, {
                  features: currentFeatures,
                  productTitle,
                  article: resolvedArticle,
                });
                void pipelineMetrics.aiCacheRemoteHit();
                return {
                  ok: true as const,
                  analysis: overlaid,
                  fromCache: true,
                  analysisSource: 'remote_cache' as const,
                  cacheReason: refineCacheReasonForSource('REVIEWS_MATCH', 'remote'),
                  cacheConfidence: decided.score,
                };
              }
            }
          }

          void pipelineMetrics.aiCacheMiss();

          if (wantDeep) {
            const premiumDeep = await isPremium();
            if (!premiumDeep) {
              return {
                ok: false as const,
                error: 'Глубокий разбор (AI + веб) доступен в Premium',
              };
            }
          }

          // Soft refresh: не сбрасываем Sonar; hard + deep — forceRefreshWeb
          const runResult = await runFullProductAnalysis(
            {
              productTitle,
              productPrice,
              oldPrice,
              marketplace,
              article,
              productId,
              forceRefreshWeb: Boolean(forceHardRefresh) && wantDeep,
              reviews,
              totalReviewsFound: totalFound,
              priceHistory: historyFormatted,
              compareOffers,
            },
            {
              webResearch: wantDeep,
              staleCachedResult: cached?.result ?? remoteCachedAnalysis,
              staleCacheSavedAt: cached?.savedAt,
            },
          );

          const analysisWithOverlay = withPriceInsightOverlay(runResult.analysis, overlayInput);

          if (runResult.source === 'cloud' || runResult.source === 'local' || runResult.source === 'cache') {
            await saveCachedFullAnalysis(
              cacheRef,
              analysisWithOverlay,
              reviews,
              cardFp,
              productPrice,
              {
                features: currentFeatures,
                productTitle,
                article: resolvedArticle,
              },
            );
          }

          if (mp && productId && runResult.source === 'cloud') {
            void pipelineMetrics.aiCloudRun();
            void putRemoteFullProductCache({
              marketplace: mp,
              productId,
              productTitle,
              rawReviews: reviews,
              aiAnalysis: analysisWithOverlay,
            });
          }

          return {
            ok: true as const,
            analysis: analysisWithOverlay,
            fromCache: runResult.source === 'cache' || runResult.source === 'stale_cache',
            analysisSource: runResult.source,
            cacheNote: runResult.cacheNote,
            cacheReason: (runResult.source === 'cache' || runResult.source === 'stale_cache'
              ? 'LOCAL_CACHE'
              : 'NEW_ANALYSIS') as AiCacheReason,
            cacheConfidence: runResult.source === 'cloud' ? 100 : 80,
          };
          })();

          return applyQuotaAndJob(flightKey, productId, canonicalUrl, inner);
        });

        try {
          sendResponse(result);
        } catch {
          // popup закрыт — результат уже в session job + кэше
        }
      } catch (error) {
        const errMsg = formatApiErrorForUser(error, 'Ошибка полного анализа');
        try {
          await setFullAnalysisJobSnapshot({
            flightKey: analysisSingleflightKey({
              marketplace: marketplace as string,
              productId,
              url: productUrl,
            }),
            productId,
            productUrl,
            intent,
            status: 'error',
            startedAt: Date.now(),
            finishedAt: Date.now(),
            error: errMsg,
          });
        } catch {
          // ignore
        }
        try {
          sendResponse({
            ok: false,
            error: errMsg,
          });
        } catch {
          // popup закрыт
        }
      } finally {
        if (locked) await setFullAnalysisBusy(false);
      }
    })();

    return true;
  }

  return false;
});

setupNotificationHandlers();
schedulePriceChecks();
void runStartupPriceCheck();
