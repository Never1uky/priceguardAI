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
import { getCompareProducts, setSelectedCompareId } from '@/lib/comparison-storage';
import { shouldRunCompare } from '@/lib/compare-cache';
import { resolveAndAddCompareProduct, linkMarketplaceOffer } from '@/lib/compare-resolve';
import { refreshCompareProduct } from '@/lib/compare-service';
import { runCompareJob, isCompareRunning } from '@/lib/compare-jobs';
import { selectCompareSearchCandidate } from '@/lib/compare-candidate-select';
import { fetchOfferFromUrl } from '@/lib/offer-fetch';
import type { ComparisonMarketplace } from '@/types/comparison';
import { runFullProductAnalysis } from '@/lib/ai/full-analysis';
import { collectReviewsForProduct } from '@/lib/reviews/collect-reviews';
import { withReviewCollectGuard } from '@/lib/reviews/collect-guard';
import { rejectAndResearchMarketplace } from '@/lib/compare-reject';
import {
  resolveReviewTarget,
  resolveReviewTargets,
  classifyReviewInput,
} from '@/lib/reviews/resolve-target';
import { loadReviewProductFromInput } from '@/lib/reviews/load-review-product';
import {
  getCachedFullAnalysis,
  saveCachedFullAnalysis,
  shouldReturnCachedFullAnalysis,
} from '@/lib/full-analysis-cache';
import { computeCardFingerprint, cardFingerprintsMatch } from '@/lib/card-fingerprint';
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
  trackProduct,
  updateTrackedProductPrice,
  isTargetPriceReached,
  syncTrackedProductsWithCloud,
} from '@/lib/storage';
import type { CompareProduct } from '@/types/comparison';
import type { FullProductAnalysis } from '@/types/full-analysis';
import type { Product, TrackedProduct } from '@/types/product';
import type { Marketplace } from '@/types/product';
import { MIN_REVIEWS_FOR_ANALYSIS } from '@/types/review-analysis';
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
  canTrackMoreProducts,
  recordFullAnalysis,
} from '@/lib/subscription';

const ALARM_NAME = 'priceguard-price-check';
const STARTUP_CHECK_KEY = 'priceguard_last_startup_check';
/** Как Palert: проверка каждые 6 часов */
const CHECK_INTERVAL_MINUTES = 6 * 60;
const STARTUP_CHECK_COOLDOWN_MS = 2 * 60 * 60 * 1000;

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

    const updated: Product = {
      ...product,
      url: pageUrl,
      title: offer.title || product.title,
      price: offer.price,
      oldPrice: offer.oldPrice ?? product.oldPrice,
      imageUrl: offer.imageUrl || product.imageUrl,
      imageUrlAlternatives,
      scrapedAt: Date.now(),
    };

    const priceChange = await updateTrackedProductPrice(updated);
    const canNotify = await areNotificationsEnabledForProduct(product.id);

    if (priceChange && canNotify) {
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
  const products = await getCompareProducts();
  if (!products.length) return;

  for (const product of products) {
    try {
      const result = await refreshCompareProduct(product, options?.force ?? false);
      await checkComparePriceDrops(product, result.offers);
    } catch (error) {
      console.warn('[PriceGuard] compare price check:', error);
    }
    await delay(2_000);
  }
}

async function runPeriodicPriceChecks(options?: { force?: boolean }): Promise<void> {
  await checkAllTrackedPrices(options);
  await checkAllComparePrices();
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

chrome.runtime.onInstalled.addListener(() => {
  console.info('[PriceGuard AI] Extension installed');
  setupNotificationHandlers();
  setupProductPageNavigation();
  schedulePriceChecks();
  void runStartupPriceCheck();
  void syncCloudIfAuthed();
});

chrome.runtime.onStartup.addListener(() => {
  setupNotificationHandlers();
  setupProductPageNavigation();
  schedulePriceChecks();
  void runStartupPriceCheck();
  void syncCloudIfAuthed();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    void runPeriodicPriceChecks();
  }
});

void getAuthSession().then((session) => {
  if (session) {
    void syncCloudIfAuthed();
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'GET_ACTIVE_TAB_PRODUCT') {
    void (async () => {
      const tab = await findActiveProductTab();
      agentLog(
        'background/index.ts:GET_ACTIVE_TAB_PRODUCT',
        'resolved product tab',
        { tabId: tab?.id ?? null, url: tab?.url?.slice(0, 120) ?? null },
        'B',
      );

      const result = tab ? await resolveProductForTab(tab) : { ok: false, error: 'Активная вкладка не найдена' };

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

      sendResponse(result);
    })();

    return true;
  }

  if (message.type === 'DUMP_AGENT_LOGS') {
    void flushAgentLogs().then((count) => sendResponse({ ok: true, count }));
    return true;
  }

  if (message.type === 'PRODUCT_SCRAPED') {
    const product = message.payload as Product;
    chrome.action.setBadgeText({ text: '●' });
    chrome.action.setBadgeBackgroundColor({ color: '#16a34a' });
    chrome.storage.local.set({ priceguard_badge_product: product.id });
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === 'PRICE_DROP') {
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
    void runPeriodicPriceChecks({ force: true }).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message.type === 'REFRESH_ALL_COMPARE_PRICES') {
    void checkAllComparePrices({ force: true }).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message.type === 'STARTUP_PRICE_CHECK') {
    void runStartupPriceCheck().then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message.type === 'UNTRACK_PRODUCT') {
    const { productId } = message.payload as { productId: string };
    void removeTrackedProduct(productId).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message.type === 'TRACK_FROM_PANEL') {
    const { product } = message.payload as { product: Product };
    void (async () => {
      const tracked = await getTrackedProducts();
      const alreadyTracked = tracked.some((p) => p.id === product.id);
      if (!alreadyTracked) {
        const { allowed, limit } = await canTrackMoreProducts(tracked.length);
        if (!allowed) {
          sendResponse({ ok: false, error: `Лимит бесплатной версии: ${limit} товаров` });
          return;
        }
      }
      await trackProduct({ ...product, url: toCanonicalProductUrl(product.url, product.marketplace) });
      if (product.authenticity) {
        void logAuthenticityCheck({
          marketplace: product.marketplace,
          article: product.article,
          status: product.authenticity.status,
          source: 'track',
        });
      }
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (message.type === 'SET_TARGET_PRICE') {
    const { productId, targetPrice } = message.payload as {
      productId: string;
      targetPrice: number;
    };
    void setTargetPrice(productId, targetPrice).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message.type === 'GET_PANEL_STATE') {
    const { productId } = message.payload as { productId: string };
    void (async () => {
      const [history, tracked] = await Promise.all([
        getPriceHistory(productId),
        getTrackedProduct(productId),
      ]);
      sendResponse({
        ok: true,
        history,
        isTracked: Boolean(tracked),
        targetPrice: tracked?.targetPrice,
      });
    })();
    return true;
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
          // research = полный SERP на других площадках (refresh без поиска даёт мгновенный notFound)
          void runCompareJob(product, Boolean(forceCompare), 'research');
        }
      } catch (error) {
        if (savedProductId) {
          safeRespond({ ok: true, productId: savedProductId, started: true, recovered: true });
          return;
        }
        safeRespond({
          ok: false,
          error: userFacingError(error, 'Не удалось добавить в сравнение'),
        });
      }
    })();

    return true;
  }

  if (message.type === 'ADD_COMPARE_BY_URL') {
    const { url, article, title, price, oldPrice } = message.payload as {
      url: string;
      article?: string;
      title?: string;
      price?: number;
      oldPrice?: number;
    };

    void (async () => {
      try {
        const product = await resolveAndAddCompareProduct(url, article, {
          title,
          price,
          oldPrice,
        });
        sendResponse({ ok: true, product });
      } catch (error) {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : 'Не удалось добавить товар',
        });
      }
    })();

    return true;
  }

  if (message.type === 'LINK_MARKETPLACE_OFFER') {
    const { productId, marketplace, url } = message.payload as {
      productId: string;
      marketplace: import('@/types/comparison').ComparisonMarketplace;
      url: string;
    };

    void (async () => {
      try {
        const product = await linkMarketplaceOffer(productId, marketplace, url);
        sendResponse({ ok: true, product });
      } catch (error) {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : 'Не удалось привязать ссылку',
        });
      }
    })();

    return true;
  }

  if (message.type === 'SELECT_COMPARE_CANDIDATE') {
    const { productId, marketplace, url } = message.payload as {
      productId: string;
      marketplace: import('@/types/comparison').ComparisonMarketplace;
      url: string;
    };

    void (async () => {
      try {
        const product = await selectCompareSearchCandidate(productId, marketplace, url);
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

    void (async () => {
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
        sendResponse({ ok: false, error: 'Товар не выбран' });
        return;
      }

      if (!force && (await isCompareRunning(product.id))) {
        sendResponse({ ok: true, started: false, alreadyRunning: true, productId: product.id });
        return;
      }

      void runCompareJob(product, force, mode);
      sendResponse({ ok: true, started: true, productId: product.id });
    })();

    return true;
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
        const { clearAllBoundTargets } = await import('@/lib/candidate-pool');
        const { updateCompareProduct } = await import('@/lib/comparison-storage');
        const cleared = clearAllBoundTargets(product);
        await updateCompareProduct(cleared);
        // force=true снимает чужой/свой lock и перезапускает полный SERP
        void runCompareJob(cleared, true, 'research');
        sendResponse({ ok: true, started: true, productId: product.id });
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

  if (message.type === 'RESOLVE_REVIEW_TARGET') {
    const { input, marketplace } = message.payload as {
      input: string;
      marketplace?: Marketplace;
    };

    void (async () => {
      try {
        const kind = classifyReviewInput(input.trim());
        if (kind === 'model') {
          sendResponse({
            ok: false,
            error:
              'Поиск по модели отключён. Вставьте ссылку на карточку или артикул Wildberries.',
          });
          return;
        }
        if (kind === 'article') {
          const targets = await resolveReviewTargets(input);
          if (targets.length > 0) {
            sendResponse({ ok: true, targets, target: targets[0] });
            return;
          }
        }
        const target = await resolveReviewTarget(input, marketplace);
        sendResponse({ ok: true, target, targets: [target] });
      } catch (error) {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : 'Не удалось найти товар',
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
        const collected = await withReviewCollectGuard(
          marketplace,
          productUrl,
          'preview',
          () =>
            collectReviewsForProduct({
              productUrl,
              marketplace,
              article,
              filter: filter ?? 'all',
              preferActiveTab: true,
              preferCurrentPage: true,
              previewOnly: true,
              allowNavigation: false,
            }),
        );

        sendResponse({
          ok: true,
          previewItems: collected.previewItems,
          totalFound: collected.totalFound,
          reviewCount: collected.reviews.length,
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

  if (message.type === 'ANALYZE_REVIEWS') {
    sendResponse({
      ok: false,
      error:
        'Локальный анализ отзывов отключён. Используйте «Полный AI-анализ» на вкладке «Отзывы».',
    });
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
      /** Жёсткий refresh: сбрасывает и Sonar web-research */
      forceHardRefresh?: boolean;
    };

    void (async () => {
      let locked = false;
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

        const result = await withAnalysisSingleflight(flightKey, async () => {
          locked = true;
          await setFullAnalysisBusy(true);

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

          // Soft refresh: overlay цены без сбора отзывов и без AI, если static кэш есть
          if (
            softRefresh &&
            !skipStaticCache &&
            cached?.result &&
            cardFingerprintsMatch(cached.cardFingerprint, cardFp)
          ) {
            void pipelineMetrics.aiCacheLocalHit();
            return {
              ok: true as const,
              analysis: withPriceInsightOverlay(cached.result, overlayInput),
              fromCache: true,
              analysisSource: 'cache' as const,
              cacheNote: 'Обновлены цена и сравнение — AI-текст без изменений.',
            };
          }

          // E11: общий Edge product-intel (cache / server reviews / AI)
          if (!skipStaticCache) {
            const viaIntel = await analyzeViaProductIntel({
              url: canonicalUrl,
              marketplace: mp,
              productId,
              productUrl: canonicalUrl,
              allowGenerate: true,
            });
            if (viaIntel?.analysis && viaIntel.card.analysisStatus === 'ready') {
              const overlaid = withPriceInsightOverlay(viaIntel.analysis, overlayInput);
              await saveCachedFullAnalysis(cacheRef, overlaid, [], cardFp);
              if (viaIntel.card.fromCache) void pipelineMetrics.aiCacheRemoteHit();
              else void pipelineMetrics.aiCloudRun();
              return {
                ok: true as const,
                analysis: overlaid,
                fromCache: viaIntel.card.fromCache,
                analysisSource: viaIntel.card.fromCache
                  ? ('remote_cache' as const)
                  : ('cloud' as const),
                cacheNote: viaIntel.card.fromCache
                  ? 'Из общего AI Cache (product-intel).'
                  : 'Свежий анализ через product-intel.',
              };
            }
          }

          const collected = await collectReviewsForProduct({
            productUrl: canonicalUrl,
            marketplace: mp,
            article: resolvedArticle,
            filter: 'all',
            preferActiveTab: true,
            preferCurrentPage: true,
          });
          const reviews = collected.reviews;
          const totalFound = collected.totalFound;

          if (reviews.length < MIN_REVIEWS_FOR_ANALYSIS) {
            return {
              ok: false as const,
              error: `Недостаточно отзывов (${reviews.length}). Откройте карточку товара и повторите.`,
            };
          }

          // Повторный вызов product-intel с локальными отзывами
          {
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
              await saveCachedFullAnalysis(cacheRef, overlaid, reviews, cardFp);
              return {
                ok: true as const,
                analysis: overlaid,
                fromCache: false,
                analysisSource: 'cloud' as const,
                cacheNote: 'Анализ через product-intel (отзывы из расширения).',
              };
            }
          }

          // Soft refresh при свежем static (после проверки reviews hash)
          if (
            softRefresh &&
            !skipStaticCache &&
            shouldReturnCachedFullAnalysis(cached, reviews, false, cardFp)
          ) {
            void pipelineMetrics.aiCacheLocalHit();
            return {
              ok: true as const,
              analysis: withPriceInsightOverlay(cached!.result, overlayInput),
              fromCache: true,
              analysisSource: 'cache' as const,
              cacheNote: 'Обновлены цена и сравнение — AI-текст без изменений.',
            };
          }

          if (shouldReturnCachedFullAnalysis(cached, reviews, skipStaticCache, cardFp)) {
            void pipelineMetrics.aiCacheLocalHit();
            return {
              ok: true as const,
              analysis: withPriceInsightOverlay(cached!.result, overlayInput),
              fromCache: true,
              analysisSource: 'cache' as const,
            };
          }

          const fullAccess = await canRunFullAnalysis();
          if (!fullAccess.allowed) {
            return { ok: false as const, error: fullAccess.reason ?? 'Недоступно' };
          }

          let remoteCachedAnalysis: FullProductAnalysis | null = null;
          if (mp && productId && !skipStaticCache) {
            const remote = await getRemoteFullProductCache(mp, productId);
            if (
              remote?.fresh &&
              remote.aiAnalysis &&
              remoteCacheMatchesReviews(remote.rawReviews, reviews)
            ) {
              remoteCachedAnalysis = remote.aiAnalysis;
              const overlaid = withPriceInsightOverlay(remote.aiAnalysis, overlayInput);
              await saveCachedFullAnalysis(cacheRef, overlaid, reviews, cardFp);
              void pipelineMetrics.aiCacheRemoteHit();
              return {
                ok: true as const,
                analysis: overlaid,
                fromCache: true,
                analysisSource: 'remote_cache' as const,
              };
            }
          }

          void pipelineMetrics.aiCacheMiss();

          // Soft refresh: не сбрасываем Sonar; hard — только по forceHardRefresh
          const runResult = await runFullProductAnalysis(
            {
              productTitle,
              productPrice,
              oldPrice,
              marketplace,
              article,
              productId,
              forceRefreshWeb: Boolean(forceHardRefresh),
              reviews,
              totalReviewsFound: totalFound,
              priceHistory: historyFormatted,
              compareOffers,
            },
            {
              staleCachedResult: cached?.result ?? remoteCachedAnalysis,
              staleCacheSavedAt: cached?.savedAt,
            },
          );

          const analysisWithOverlay = withPriceInsightOverlay(runResult.analysis, overlayInput);

          // Не сохраняем stale как fresh (анти-poison)
          if (runResult.source === 'cloud' || runResult.source === 'local') {
            await saveCachedFullAnalysis(cacheRef, analysisWithOverlay, reviews, cardFp);
          } else if (runResult.source === 'cache') {
            await saveCachedFullAnalysis(cacheRef, analysisWithOverlay, reviews, cardFp);
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

          if (runResult.source === 'cloud' && (!cached || skipStaticCache)) {
            await recordFullAnalysis();
          }

          return {
            ok: true as const,
            analysis: analysisWithOverlay,
            fromCache: runResult.source === 'cache' || runResult.source === 'stale_cache',
            analysisSource: runResult.source,
            cacheNote: runResult.cacheNote,
          };
        });

        sendResponse(result);
      } catch (error) {
        sendResponse({
          ok: false,
          error: formatApiErrorForUser(error, 'Ошибка полного анализа'),
        });
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
