import { PricesAndCompareTab, type PriceSubView } from '@/popup/components/PricesAndCompareTab';
import { ProductContextBar } from '@/popup/components/ProductContextBar';
import { Tabs } from '@/popup/components/Tabs';
import {
  getTrackedProducts,
  removeTrackedProduct,
  trackProduct,
} from '@/lib/storage';
import { resolveAfterEnsure, type AddToMyProductsResult } from '@/lib/add-to-my-products-result';
import { logAuthenticityCheck } from '@/lib/authenticity/supabase-log';
import { loadReferralSettings } from '@/lib/referral-settings';
import { canAddMyProduct, canTrackMoreProducts, isPremium, syncSubscriptionWithServer } from '@/lib/subscription';
import { isLiveProductInTrackedList } from '@/lib/price-identity';
import { loadUiTheme, saveUiTheme, type UiTheme } from '@/lib/ui-theme';
import { sendRuntimeMessage } from '@/lib/runtime-message';
import { isFullAnalysisBusy, FULL_ANALYSIS_BUSY_MESSAGE } from '@/lib/ai-busy-lock';
import {
  trackCompareStarted,
  trackExtensionStarted,
  classifyFailureReason,
  trackMonitoringRefresh,
} from '@/lib/telemetry/funnel';
import { useLiveProduct } from '@/popup/hooks/useLiveProduct';
import { loadMyProductItems, migrateMyProductsOnce } from '@/lib/my-products';
import type { Product, TrackedProduct } from '@/types/product';
import { Crown, Package, RefreshCw, Settings, Sparkles, Tag, User } from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Toaster } from '@/popup/components/Toaster';
import { toastSuccess, toastUserError, toastWarning } from '@/popup/lib/toast';
import '@/lib/supabase/price-cache';
import '@/lib/supabase/compare-sync';
import { flushPendingSync } from '@/lib/pending-sync';

const ReviewsTab = lazy(() =>
  import('@/popup/components/ReviewsTab').then((m) => ({ default: m.ReviewsTab })),
);
const MyProductsTab = lazy(() =>
  import('@/popup/components/MyProductsTab').then((m) => ({ default: m.MyProductsTab })),
);
const SettingsTab = lazy(() =>
  import('@/popup/components/SettingsTab').then((m) => ({ default: m.SettingsTab })),
);
const PremiumTab = lazy(() =>
  import('@/popup/components/PremiumTab').then((m) => ({ default: m.PremiumTab })),
);
const AuthTab = lazy(() =>
  import('@/popup/components/AuthTab').then((m) => ({ default: m.AuthTab })),
);

type TabId = 'price' | 'reviews' | 'my' | 'premium' | 'settings' | 'auth';

const POPUP_TAB_KEY = 'priceguard_popup_tab';
const UPDATE_SYNC_HINT_KEY = 'priceguard_update_sync_hint';
const ONBOARDING_SEEN_KEY = 'priceguard_onboarding_seen_v1';
const VALID_TABS = new Set<TabId>(['price', 'reviews', 'my', 'premium', 'settings', 'auth']);

function isTabId(value: unknown): value is TabId {
  return typeof value === 'string' && VALID_TABS.has(value as TabId);
}

export function App() {
  const [activeTab, setActiveTab] = useState<TabId>('price');
  const [tabRestored, setTabRestored] = useState(false);
  const {
    product: liveProduct,
    dataSource,
    isLoading,
    error: liveError,
    priceHistory: currentHistory,
    refresh: refreshLiveProduct,
  } = useLiveProduct();

  const [trackedProducts, setTrackedProducts] = useState<TrackedProduct[]>([]);
  const [myProductsCount, setMyProductsCount] = useState(0);
  const [focusCompareId, setFocusCompareId] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [isComparePending, setIsComparePending] = useState(false);
  const [premiumActive, setPremiumActive] = useState(false);
  const [uiTheme, setUiTheme] = useState<UiTheme>('light');
  const [fullAnalysisBusy, setFullAnalysisBusy] = useState(false);
  const [priceSubView, setPriceSubView] = useState<PriceSubView>('current');
  const [listRefreshing, setListRefreshing] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [myProductsGate, setMyProductsGate] = useState({
    atLimit: false,
    alreadyPresent: false,
    limit: 5,
  });
  const [premiumReason, setPremiumReason] = useState<'limit' | null>(null);

  const loadTracked = useCallback(async () => {
    const [tracked, items] = await Promise.all([getTrackedProducts(), loadMyProductItems()]);
    setTrackedProducts(tracked);
    setMyProductsCount(items.length);
  }, []);

  useEffect(() => {
    void loadUiTheme().then(setUiTheme);
    void migrateMyProductsOnce().then(() => loadTracked());
    void loadReferralSettings();
    void (async () => {
      const [stored, busy] = await Promise.all([
        chrome.storage.local.get(POPUP_TAB_KEY),
        isFullAnalysisBusy(),
      ]);
      const saved = stored[POPUP_TAB_KEY];
      if (isTabId(saved)) {
        if (busy && saved !== 'reviews') {
          setActiveTab('price');
        } else {
          setActiveTab(saved);
        }
      }
      setTabRestored(true);
    })();
  }, [loadTracked]);

  useEffect(() => {
    void chrome.storage.local.get(ONBOARDING_SEEN_KEY).then((stored) => {
      if (!stored[ONBOARDING_SEEN_KEY]) setShowOnboarding(true);
    });
  }, []);

  useEffect(() => {
    if (!tabRestored) return;
    void chrome.storage.local.set({ [POPUP_TAB_KEY]: activeTab });
  }, [activeTab, tabRestored]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', uiTheme === 'dark');
  }, [uiTheme]);

  useEffect(() => {
    void chrome.storage.local.get(UPDATE_SYNC_HINT_KEY).then((stored) => {
      if (!stored[UPDATE_SYNC_HINT_KEY]) return;
      toastWarning(
        'Обновление установлено — откройте «Аккаунт» и нажмите «Синхронизировать», чтобы подтянуть лицензию.',
      );
      void chrome.storage.local.remove(UPDATE_SYNC_HINT_KEY);
    });
  }, []);

  useEffect(() => {
    void flushPendingSync();
  }, []);

  useEffect(() => {
    void trackExtensionStarted();
  }, []);

  useEffect(() => {
    void isFullAnalysisBusy().then(setFullAnalysisBusy);
    const onSessionChange = (
      changes: { [key: string]: chrome.storage.StorageChange },
      area: string,
    ) => {
      if (area === 'session' && changes.priceguard_full_analysis_busy !== undefined) {
        setFullAnalysisBusy(Boolean(changes.priceguard_full_analysis_busy.newValue));
      }
    };
    chrome.storage.onChanged.addListener(onSessionChange);
    return () => chrome.storage.onChanged.removeListener(onSessionChange);
  }, []);

  useEffect(() => {
    if (activeTab === 'price') {
      void refreshLiveProduct({ silent: true });
    }
  }, [activeTab, refreshLiveProduct]);

  useEffect(() => {
    if (!liveProduct?.url) {
      setMyProductsGate({ atLimit: false, alreadyPresent: false, limit: 5 });
      return;
    }
    void canAddMyProduct({ url: liveProduct.url }).then((gate) => {
      setMyProductsGate({
        atLimit: !gate.allowed && !gate.alreadyPresent,
        alreadyPresent: gate.alreadyPresent,
        limit: gate.limit,
      });
    });
  }, [liveProduct?.url, myProductsCount, premiumActive]);

  useEffect(() => {
    void isPremium().then(setPremiumActive);
    void syncSubscriptionWithServer().then(() => isPremium().then(setPremiumActive));
    const onSubChange = (changes: { [key: string]: chrome.storage.StorageChange }, area: string) => {
      if (area === 'local' && changes.priceguard_subscription) {
        void isPremium().then(setPremiumActive);
      }
    };
    chrome.storage.onChanged.addListener(onSubChange);
    return () => chrome.storage.onChanged.removeListener(onSubChange);
  }, []);

  useEffect(() => {
    const onStorageChange = (
      changes: { [key: string]: chrome.storage.StorageChange },
      areaName: string,
    ) => {
      if (
        areaName === 'local' &&
        (changes.priceguard_storage || changes.priceguard_compare_products)
      ) {
        void loadTracked();
      }
    };
    chrome.storage.onChanged.addListener(onStorageChange);
    return () => chrome.storage.onChanged.removeListener(onStorageChange);
  }, [loadTracked]);

  const goToMyProducts = (compareId?: string | null) => {
    if (compareId) setFocusCompareId(compareId);
    setActiveTab('my');
    setPriceSubView('current');
  };

  const handleThemeChange = async (theme: UiTheme) => {
    setUiTheme(theme);
    await saveUiTheme(theme);
  };

  const handleTrack = async () => {
    if (!liveProduct) return;
    await addToMyProducts(liveProduct, { research: true });
  };

  /**
   * Единый поток: upsert в «Мои товары» + слежение + research → вкладка «Мои».
   * alreadyPresent не занимает новый слот (grandfather / лимит).
   * Успех = tracked ИЛИ compare; ENSURE fail при наличии в списке → warning, не error.
   */
  const addToMyProducts = async (
    product: Product,
    options?: { research?: boolean },
  ): Promise<AddToMyProductsResult | undefined> => {
    const wantResearch = options?.research !== false;

    if (fullAnalysisBusy) {
      toastUserError(FULL_ANALYSIS_BUSY_MESSAGE);
      return undefined;
    }

    if (!product.url) {
      toastUserError('Нет данных товара — дождитесь загрузки карточки');
      return undefined;
    }

    setIsComparePending(true);
    try {
      void trackCompareStarted(product.marketplace);
      const gate = await canAddMyProduct({ url: product.url });
      if (!gate.allowed && !gate.alreadyPresent) {
        toastUserError(
          `Лимит: ${gate.limit} товаров в «Мои товары». Удалите лишние или оформите Premium.`,
        );
        return {
          kind: 'limit',
          message: `Лимит: ${gate.limit} товаров в «Мои товары». Удалите лишние или оформите Premium.`,
          compareId: null,
          inTracked: false,
          inCompare: false,
          researchStarted: false,
        };
      }

      // Track (alerts on) — upsert existing is fine
      if (!gate.alreadyPresent || !trackedProducts.some((p) => p.id === product.id)) {
        if (!gate.alreadyPresent) {
          const { allowed, limit } = await canTrackMoreProducts();
          if (!allowed) {
            toastUserError(
              `Лимит: ${limit} товаров в «Мои товары». Удалите лишние или оформите Premium.`,
            );
            return {
              kind: 'limit',
              message: `Лимит: ${limit} товаров в «Мои товары». Удалите лишние или оформите Premium.`,
              compareId: null,
              inTracked: false,
              inCompare: false,
              researchStarted: false,
            };
          }
        }
        await trackProduct(product);
        if (product.authenticity) {
          void logAuthenticityCheck({
            marketplace: product.marketplace,
            article: product.article,
            status: product.authenticity.status,
            source: 'track',
          });
        }
      }

      let ensure: {
        ok?: boolean;
        error?: string;
        productId?: string;
        started?: boolean;
      } | null = null;

      try {
        ensure = await sendRuntimeMessage<{
          ok?: boolean;
          error?: string;
          productId?: string;
          started?: boolean;
        }>({
          type: 'ENSURE_COMPARE_PRODUCT',
          payload: {
            url: product.url,
            article: product.article,
            title: product.title,
            price: product.price,
            oldPrice: product.oldPrice,
            forceCompare: wantResearch,
            authenticity: product.authenticity,
          },
        });
      } catch (ensureErr) {
        ensure = {
          ok: false,
          error: ensureErr instanceof Error ? ensureErr.message : String(ensureErr),
        };
      }

      const result = await resolveAfterEnsure({
        product: { url: product.url, id: product.id },
        alreadyPresent: gate.alreadyPresent,
        wantResearch,
        ensure,
      });

      if (result.kind === 'limit') {
        toastUserError(result.message);
        setActiveTab('premium');
        return result;
      }

      if (result.kind === 'fail') {
        toastUserError(result.message);
        return result;
      }

      if (result.compareId) setFocusCompareId(result.compareId);

      // Explicit research if ENSURE didn't start (cache hit) but user asked
      let researchStarted = result.researchStarted;
      if (wantResearch && result.compareId && !researchStarted) {
        try {
          const researchRes = await sendRuntimeMessage<{
            ok?: boolean;
            started?: boolean;
            alreadyRunning?: boolean;
          }>({
            type: 'RESEARCH_COMPARE_PRODUCT',
            payload: { productId: result.compareId },
          });
          researchStarted =
            researchRes?.started === true || researchRes?.alreadyRunning === true;
        } catch {
          researchStarted = false;
        }
      }

      await loadTracked();

      if (wantResearch && result.compareId) {
        if (researchStarted) {
          toastSuccess('Ищем на WB / Ozon / Я.Маркет…');
        } else {
          toastWarning(
            'Поиск не запустился — откройте товар и нажмите «Найти заново»',
          );
        }
      } else if (result.kind === 'partial') {
        toastWarning(result.message);
      } else {
        toastSuccess(result.message);
      }
      setActiveTab('my');
      return result;
    } catch (err) {
      const result = await resolveAfterEnsure({
        product: { url: product.url, id: product.id },
        wantResearch,
        ensure: {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        },
      });

      if (result.kind === 'limit') {
        toastUserError(result.message);
        setActiveTab('premium');
        return result;
      }

      if (result.kind === 'fail') {
        toastUserError(result.message);
        return result;
      }

      if (result.compareId) setFocusCompareId(result.compareId);
      if (result.kind === 'partial') {
        toastWarning(result.message);
      } else {
        toastSuccess(result.message);
      }
      setActiveTab('my');
      return result;
    } finally {
      setIsComparePending(false);
    }
  };

  const handleUntrack = async () => {
    const product = liveProduct;
    if (!product) return;
    if (!window.confirm('Перестать следить за ценой этого товара?')) return;

    await removeTrackedProduct(product.id);
    await loadTracked();
  };

  const handleRefreshTrackedList = async () => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      toastUserError('Нет сети — проверьте интернет и повторите.');
      return;
    }
    setListRefreshing(true);
    const started = Date.now();
    try {
      const refreshWork = (async () => {
        const { syncTrackedProductsWithCloud } = await import('@/lib/storage');
        const { syncCompareProductsFromCloud } = await import('@/lib/comparison-storage');
        await syncTrackedProductsWithCloud({ reconcile: true });
        await syncCompareProductsFromCloud();
        await sendRuntimeMessage({ type: 'CHECK_PRICES_NOW' });
        await loadTracked();
        await refreshLiveProduct({ silent: true });
      })();
      const timeout = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('timeout')), 20_000);
      });
      await Promise.race([refreshWork, timeout]);
      toastSuccess('Список обновлён');
      trackMonitoringRefresh(true, Date.now() - started);
    } catch (error) {
      const msg = error instanceof Error && error.message === 'timeout'
        ? 'Не удалось обновить за 20 с — проверьте интернет.'
        : 'Не удалось обновить список';
      toastUserError(msg);
      trackMonitoringRefresh(false, Date.now() - started, classifyFailureReason(error));
    } finally {
      setListRefreshing(false);
    }
  };

  const handleCheckPrices = async () => {
    setIsChecking(true);
    const started = Date.now();
    try {
      await sendRuntimeMessage({ type: 'CHECK_PRICES_NOW' });
      await loadTracked();
      await refreshLiveProduct();
      trackMonitoringRefresh(true, Date.now() - started);
    } catch (error) {
      toastUserError('Не удалось проверить цены');
      trackMonitoringRefresh(false, Date.now() - started, classifyFailureReason(error));
    } finally {
      setIsChecking(false);
    }
  };

  const handleTabChange = (id: string) => {
    if (fullAnalysisBusy && id !== activeTab && id !== 'reviews') {
      toastUserError(FULL_ANALYSIS_BUSY_MESSAGE);
      return;
    }
    setActiveTab(id as TabId);
  };

  const tabs = [
    { id: 'price' as const, label: 'Цены', icon: Tag },
    { id: 'reviews' as const, label: 'Отзывы', icon: Sparkles },
    { id: 'my' as const, label: 'Мои товары', icon: Package, badge: myProductsCount },
    { id: 'auth' as const, label: 'Аккаунт', icon: User },
    { id: 'settings' as const, label: 'Настройки', icon: Settings },
  ];

  const dismissOnboarding = () => {
    setShowOnboarding(false);
    void chrome.storage.local.set({ [ONBOARDING_SEEN_KEY]: true });
  };

  return (
    <div className="relative w-[400px] overflow-x-hidden bg-background text-foreground">
      <Toaster />
      <header className="border-b border-border bg-hero text-hero-foreground">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <img
              src={chrome.runtime.getURL('public/icons/icon48.png')}
              alt=""
              width={36}
              height={36}
              className="h-9 w-9 shrink-0 rounded-sm"
              aria-hidden
            />
            <div className="min-w-0">
              <h1 className="text-[15px] font-semibold tracking-tight text-foreground">
                PriceGuard AI
              </h1>
              <p className="pg-caption">
                Сравнение цен на Wildberries, Ozon и Маркете
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              size="icon-sm"
              variant="ghost"
              className={
                premiumActive
                  ? 'text-purple hover:bg-accent hover:text-purple'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              }
              onClick={() => {
                if (fullAnalysisBusy) {
                  toastUserError(FULL_ANALYSIS_BUSY_MESSAGE);
                  return;
                }
                setActiveTab('premium');
              }}
              disabled={fullAnalysisBusy}
              title="Premium"
              aria-label="Premium"
            >
              <Crown className="h-[18px] w-[18px]" strokeWidth={1.75} aria-hidden />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              className="text-muted-foreground hover:bg-accent hover:text-foreground"
              onClick={() => void handleCheckPrices()}
              disabled={isChecking || trackedProducts.length === 0}
              title="Проверить цены сейчас"
              aria-label="Проверить цены сейчас"
            >
              <RefreshCw
                className={`h-[18px] w-[18px] ${isChecking ? 'animate-spin' : ''}`}
                strokeWidth={1.75}
                aria-hidden
              />
            </Button>
          </div>
        </div>
        <ProductContextBar product={liveProduct} dataSource={dataSource} isLoading={isLoading} />
      </header>

      <div className="space-y-4 p-4 pb-5">
        {showOnboarding && activeTab === 'price' && !liveProduct && !isLoading && (
          <div className="rounded-md border border-primary/20 bg-primary/5 p-3">
            <p className="pg-subtitle">Откройте товар на Wildberries, Ozon или Яндекс.Маркете</p>
            <p className="mt-1 pg-hint text-foreground/80">
              Сравнение цен появится автоматически. Расширение читает только страницы этих
              маркетплейсов для сравнения цен, историю других сайтов не собирает.
            </p>
            <Button size="sm" className="mt-2" onClick={dismissOnboarding}>
              Понятно
            </Button>
          </div>
        )}

        <Tabs
          tabs={tabs}
          activeTab={activeTab}
          onChange={handleTabChange}
          lockedTabIds={fullAnalysisBusy ? tabs.map((t) => t.id).filter((id) => id !== 'reviews') : []}
        />

        {fullAnalysisBusy && (
          <p className="rounded-md bg-primary/10 px-3 py-2 text-center pg-hint text-primary">
            {FULL_ANALYSIS_BUSY_MESSAGE}
          </p>
        )}

        {activeTab === 'price' && (
          <PricesAndCompareTab
            isTabActive={activeTab === 'price'}
            subView={priceSubView}
            onSubViewChange={setPriceSubView}
            product={liveProduct}
            isTracked={
              liveProduct ? isLiveProductInTrackedList(liveProduct, trackedProducts) : false
            }
            atMyProductsLimit={myProductsGate.atLimit && !myProductsGate.alreadyPresent}
            myProductsLimit={myProductsGate.limit}
            onOpenPremium={() => {
              setPremiumReason('limit');
              setActiveTab('premium');
            }}
            isLoading={isLoading}
            priceHistory={liveProduct ? currentHistory : []}
            error={liveError}
            onTrack={() => void handleTrack()}
            onUntrack={() => void handleUntrack()}
            onAddToMyProducts={() => {
              if (liveProduct) void addToMyProducts(liveProduct, { research: true });
            }}
            isComparePending={isComparePending}
            fullAnalysisBusy={fullAnalysisBusy}
            onGoToMyProducts={() => goToMyProducts(focusCompareId)}
            onOpenAuth={() => setActiveTab('auth')}
          />
        )}

        <Suspense
          fallback={
            <p className="py-8 text-center pg-hint text-muted-foreground">Загрузка…</p>
          }
        >
          {activeTab === 'reviews' && (
            <ReviewsTab
              product={liveProduct}
              productDataSource={dataSource}
              isPremium={premiumActive}
              suppressReviewFetch={isComparePending}
              onOpenPremium={() => setActiveTab('premium')}
              onOpenAuth={() => setActiveTab('auth')}
              onOpenSettings={() => setActiveTab('settings')}
              onFullAnalysisBusyChange={setFullAnalysisBusy}
            />
          )}

          {activeTab === 'settings' && (
            <SettingsTab
              onOpenPremium={() => setActiveTab('premium')}
              theme={uiTheme}
              onThemeChange={(theme) => void handleThemeChange(theme)}
            />
          )}

          {activeTab === 'auth' && (
            <AuthTab onAuthed={() => void loadTracked()} />
          )}

          {activeTab === 'premium' && (
            <PremiumTab
              reason={premiumReason}
              onClose={() => {
                setPremiumReason(null);
                setActiveTab('price');
              }}
              onOpenAuth={() => setActiveTab('auth')}
            />
          )}

          {activeTab === 'my' && (
            <MyProductsTab
              isActive={activeTab === 'my'}
              focusCompareId={focusCompareId}
              onClearFocusCompareId={() => setFocusCompareId(null)}
              liveProduct={liveProduct}
              onAddLiveProduct={() => {
                if (liveProduct) void addToMyProducts(liveProduct, { research: true });
              }}
              onRefreshCloud={() => void handleRefreshTrackedList()}
              refreshing={listRefreshing}
            />
          )}
        </Suspense>
      </div>
    </div>
  );
}
