import { AuthTab } from '@/popup/components/AuthTab';
import { PricesAndCompareTab, type PriceSubView } from '@/popup/components/PricesAndCompareTab';
import { PremiumTab } from '@/popup/components/PremiumTab';
import { ProductContextBar } from '@/popup/components/ProductContextBar';
import { SettingsTab } from '@/popup/components/SettingsTab';
import { ReviewsTab } from '@/popup/components/ReviewsTab';
import { TrackedTab } from '@/popup/components/TrackedTab';
import { Tabs } from '@/popup/components/Tabs';
import {
  getStorage,
  getTrackedProducts,
  removeTrackedProduct,
  trackProduct,
} from '@/lib/storage';
import { findCompareProductByUrl } from '@/lib/compare-service';
import { logAuthenticityCheck } from '@/lib/authenticity/supabase-log';
import { loadReferralSettings } from '@/lib/referral-settings';
import { canTrackMoreProducts, isPremium, syncSubscriptionWithServer } from '@/lib/subscription';
import { loadUiTheme, saveUiTheme, type UiTheme } from '@/lib/ui-theme';
import { sendRuntimeMessage } from '@/lib/runtime-message';
import { isFullAnalysisBusy, FULL_ANALYSIS_BUSY_MESSAGE } from '@/lib/ai-busy-lock';
import { useLiveProduct } from '@/popup/hooks/useLiveProduct';
import type { PricePoint, TrackedProduct } from '@/types/product';
import { Bell, Crown, RefreshCw, Settings, Shield, Sparkles, Tag, User } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Toaster } from '@/popup/components/Toaster';
import { toastError, toastSuccess } from '@/popup/lib/toast';

type TabId = 'price' | 'reviews' | 'tracked' | 'premium' | 'settings' | 'auth';

export function App() {
  const [activeTab, setActiveTab] = useState<TabId>('price');
  const {
    product: liveProduct,
    dataSource,
    isLoading,
    error: liveError,
    priceHistory: currentHistory,
    refresh: refreshLiveProduct,
  } = useLiveProduct();

  const [trackedProducts, setTrackedProducts] = useState<TrackedProduct[]>([]);
  const [priceHistory, setPriceHistory] = useState<Record<string, PricePoint[]>>({});
  const [selectedTrackedId, setSelectedTrackedId] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [isComparePending, setIsComparePending] = useState(false);
  const [premiumActive, setPremiumActive] = useState(false);
  const [uiTheme, setUiTheme] = useState<UiTheme>('light');
  const [removingTrackedId, setRemovingTrackedId] = useState<string | null>(null);
  const [fullAnalysisBusy, setFullAnalysisBusy] = useState(false);
  const [priceSubView, setPriceSubView] = useState<PriceSubView>('current');
  const [listRefreshing, setListRefreshing] = useState(false);

  const loadTracked = useCallback(async () => {
    const [tracked, storage] = await Promise.all([getTrackedProducts(), getStorage()]);
    setTrackedProducts(tracked);
    setPriceHistory(storage.priceHistory);
  }, []);

  useEffect(() => {
    void loadUiTheme().then(setUiTheme);
    void loadTracked();
    void loadReferralSettings();
  }, [loadTracked]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', uiTheme === 'dark');
  }, [uiTheme]);

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
      if (areaName === 'local' && changes.priceguard_storage) {
        void loadTracked();
      }
    };
    chrome.storage.onChanged.addListener(onStorageChange);
    return () => chrome.storage.onChanged.removeListener(onStorageChange);
  }, [loadTracked]);

  const handleThemeChange = async (theme: UiTheme) => {
    setUiTheme(theme);
    await saveUiTheme(theme);
  };

  const handleTrack = async () => {
    if (!liveProduct) return;

    const { allowed, limit } = await canTrackMoreProducts(trackedProducts.length);
    if (!allowed) {
      toastError(`Лимит бесплатной версии: ${limit} товаров. Оформите Premium.`);
      setActiveTab('premium');
      return;
    }

    await trackProduct(liveProduct);
    if (liveProduct.authenticity) {
      void logAuthenticityCheck({
        marketplace: liveProduct.marketplace,
        article: liveProduct.article,
        status: liveProduct.authenticity.status,
        source: 'track',
      });
    }
    await loadTracked();
    setSelectedTrackedId(liveProduct.id);
    toastSuccess('Товар добавлен в отслеживаемые');
    setActiveTab('tracked');
  };

  const handleUntrack = async () => {
    const product = liveProduct;
    if (!product) return;
    if (!window.confirm('Удалить из отслеживаемых?')) return;

    await removeTrackedProduct(product.id);
    await loadTracked();
    setSelectedTrackedId(trackedProducts[0]?.id ?? null);
  };


  const handleRemoveTracked = async (id: string) => {
    setRemovingTrackedId(id);
    try {
      await removeTrackedProduct(id);
      const next = trackedProducts.filter((p) => p.id !== id);
      if (selectedTrackedId === id) {
        setSelectedTrackedId(next[0]?.id ?? null);
      }
      await loadTracked();
    } finally {
      setRemovingTrackedId(null);
    }
  };

  const handleSelectTracked = async (product: TrackedProduct) => {
    setSelectedTrackedId(product.id);
    setActiveTab('tracked');
  };

  const handleCompare = async () => {
    if (fullAnalysisBusy) {
      toastError(FULL_ANALYSIS_BUSY_MESSAGE);
      return;
    }

    if (!liveProduct?.url) {
      toastError('Нет данных товара — дождитесь загрузки карточки');
      return;
    }

    setIsComparePending(true);

    try {
      const response = await sendRuntimeMessage<{
        ok?: boolean;
        error?: string;
        productId?: string;
        started?: boolean;
        recovered?: boolean;
      }>({
        type: 'ENSURE_COMPARE_PRODUCT',
        payload: {
          url: liveProduct.url,
          article: liveProduct.article,
          title: liveProduct.title,
          price: liveProduct.price,
          oldPrice: liveProduct.oldPrice,
          forceCompare: true,
          authenticity: liveProduct.authenticity,
        },
      });

      const saved =
        response?.ok ||
        Boolean(await findCompareProductByUrl(liveProduct.url));

      if (!saved) {
        toastError(response?.error ?? 'Не удалось добавить товар в сравнение');
        return;
      }

      toastSuccess(
        response?.started
          ? 'Товар добавлен — ищем цены на других площадках'
          : 'Товар добавлен в сравнение',
      );
      setPriceSubView('compare');
    } catch (err) {
      const fallback = await findCompareProductByUrl(liveProduct.url);
      if (fallback) {
        toastSuccess('Товар добавлен в сравнение');
        setPriceSubView('compare');
        return;
      }
      toastError(
        err instanceof Error ? err.message : 'Ошибка связи с расширением при добавлении в сравнение',
      );
    } finally {
      setIsComparePending(false);
    }
  };

  const handleRefreshTrackedList = async () => {
    setListRefreshing(true);
    try {
      const { syncTrackedProductsWithCloud } = await import('@/lib/storage');
      await syncTrackedProductsWithCloud();
      // Перепроверить цены/фото всех товаров (не только облако и активную вкладку)
      await sendRuntimeMessage({ type: 'CHECK_PRICES_NOW' });
      await loadTracked();
      await refreshLiveProduct({ silent: true });
      toastSuccess('Список обновлён');
    } catch {
      toastError('Не удалось обновить список');
    } finally {
      setListRefreshing(false);
    }
  };

  const handleCheckPrices = async () => {
    setIsChecking(true);
    try {
      await sendRuntimeMessage({ type: 'CHECK_PRICES_NOW' });
      await loadTracked();
      await refreshLiveProduct();
    } catch {
      toastError('Не удалось проверить цены');
    } finally {
      setIsChecking(false);
    }
  };

  const handleTabChange = (id: string) => {
    if (fullAnalysisBusy && id !== activeTab && id !== 'reviews') {
      toastError(FULL_ANALYSIS_BUSY_MESSAGE);
      return;
    }
    setActiveTab(id as TabId);
  };

  const tabs = [
    { id: 'price' as const, label: 'Цены и сравнение', icon: Tag },
    { id: 'reviews' as const, label: 'Отзывы', icon: Sparkles },
    { id: 'tracked' as const, label: 'Список', icon: Bell, badge: trackedProducts.length },
    { id: 'auth' as const, label: 'Аккаунт', icon: User },
    { id: 'settings' as const, label: 'Настройки', icon: Settings },
  ];

  return (
    <div className="relative w-[400px] overflow-x-hidden bg-background text-foreground">
      <Toaster />
      <header className="bg-hero text-hero-foreground">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm bg-white/10 pg-glass">
              <Shield className="h-4 w-4" strokeWidth={1.75} />
            </div>
            <div className="min-w-0">
              <h1 className="text-[15px] font-semibold tracking-tight">PriceGuard AI</h1>
              <p className="pg-caption text-hero-foreground/55">WB · Ozon · Я.Маркет</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              size="icon-sm"
              variant="ghost"
              className={
                premiumActive
                  ? 'text-purple hover:bg-white/10 hover:text-purple'
                  : 'text-hero-foreground/80 hover:bg-white/10 hover:text-hero-foreground'
              }
              onClick={() => {
                if (fullAnalysisBusy) {
                  toastError(FULL_ANALYSIS_BUSY_MESSAGE);
                  return;
                }
                setActiveTab('premium');
              }}
              disabled={fullAnalysisBusy}
              title="Premium"
            >
              <Crown className="h-[18px] w-[18px]" strokeWidth={1.75} />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              className="text-hero-foreground/80 hover:bg-white/10 hover:text-hero-foreground"
              onClick={() => void handleCheckPrices()}
              disabled={isChecking || trackedProducts.length === 0}
              title="Проверить цены сейчас"
            >
              <RefreshCw
                className={`h-[18px] w-[18px] ${isChecking ? 'animate-spin' : ''}`}
                strokeWidth={1.75}
              />
            </Button>
          </div>
        </div>
        <ProductContextBar product={liveProduct} dataSource={dataSource} isLoading={isLoading} />
      </header>

      <div className="space-y-4 p-4 pb-5">
        <Tabs
          tabs={tabs}
          activeTab={activeTab}
          onChange={handleTabChange}
          lockedTabIds={fullAnalysisBusy ? tabs.map((t) => t.id).filter((id) => id !== 'reviews') : []}
        />

        {fullAnalysisBusy && (
          <p className="rounded-md bg-purple/10 px-3 py-2 text-center pg-hint text-purple">
            {FULL_ANALYSIS_BUSY_MESSAGE}
          </p>
        )}

        {activeTab === 'price' && (
          <PricesAndCompareTab
            isTabActive={activeTab === 'price'}
            subView={priceSubView}
            onSubViewChange={setPriceSubView}
            product={liveProduct}
            isTracked={liveProduct ? trackedProducts.some((p) => p.id === liveProduct.id) : false}
            isLoading={isLoading}
            priceHistory={liveProduct ? currentHistory : []}
            error={liveError}
            onTrack={() => void handleTrack()}
            onUntrack={() => void handleUntrack()}
            onRefresh={() => void refreshLiveProduct()}
            onCompare={() => void handleCompare()}
            isComparePending={isComparePending}
            fullAnalysisBusy={fullAnalysisBusy}
          />
        )}

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
          <PremiumTab onClose={() => setActiveTab('price')} onOpenAuth={() => setActiveTab('auth')} />
        )}

        {activeTab === 'tracked' && (
          <TrackedTab
            products={trackedProducts}
            priceHistory={priceHistory}
            selectedId={selectedTrackedId}
            onSelect={(p) => void handleSelectTracked(p)}
            onRemove={(id) => handleRemoveTracked(id)}
            removingTrackedId={removingTrackedId}
            onNotificationsChange={() => void loadTracked()}
            onRefresh={() => void handleRefreshTrackedList()}
            refreshing={listRefreshing}
            onOpenAuth={() => setActiveTab('auth')}
            onOpenSettings={() => setActiveTab('settings')}
          />
        )}
      </div>
    </div>
  );
}
