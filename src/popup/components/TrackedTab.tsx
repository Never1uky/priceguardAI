import { TrackedList } from '@/popup/components/TrackedList';
import { TrackedSwitcher } from '@/popup/components/TrackedSwitcher';
import { AuthenticityHint } from '@/popup/components/AuthenticityHint';
import { getPriceAlertSettings } from '@/lib/compare-price-alerts';
import { isPremium } from '@/lib/subscription';
import { canUseCloudFeatures } from '@/lib/supabase/auth-guard';
import { sendRuntimeMessage } from '@/lib/runtime-message';
import { FREE_LIMITS, PREMIUM_LIMITS } from '@/types/subscription';
import type { PricePoint, Product, TrackedProduct } from '@/types/product';
import {
  Bell,
  BellOff,
  ChevronDown,
  CloudOff,
  Loader2,
  LogIn,
  Plus,
  RefreshCw,
  Settings,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { SectionLabel } from '@/components/ui/section-label';
import { Surface } from '@/components/ui/surface';
import { PackageSearch } from 'lucide-react';
import { toastError } from '@/popup/lib/toast';
import { TelegramChannelLink } from '@/popup/components/TelegramChannelLink';

interface TrackedTabProps {
  products: TrackedProduct[];
  priceHistory: Record<string, PricePoint[]>;
  selectedId: string | null;
  onSelect: (product: TrackedProduct) => void;
  onRemove: (productId: string) => void | Promise<void>;
  removingTrackedId?: string | null;
  onNotificationsChange?: () => void;
  onRefresh?: () => void | Promise<void>;
  refreshing?: boolean;
  onOpenAuth?: () => void;
  onOpenSettings?: () => void;
  onTrackProduct?: (product: Product) => Promise<void | { kind?: string }>;
  onOpenPremium?: () => void;
}

export function TrackedTab({
  products,
  priceHistory,
  selectedId,
  onSelect,
  onRemove,
  removingTrackedId,
  onNotificationsChange,
  onRefresh,
  refreshing = false,
  onOpenAuth,
  onOpenSettings,
  onTrackProduct,
  onOpenPremium,
}: TrackedTabProps) {
  const [premium, setPremium] = useState(false);
  const [cloudSync, setCloudSync] = useState(false);
  const [globalNotificationsEnabled, setGlobalNotificationsEnabled] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [addUrl, setAddUrl] = useState('');
  const [addLoading, setAddLoading] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [collapseAllSignal, setCollapseAllSignal] = useState(0);

  useEffect(() => {
    void isPremium().then(setPremium);
    void canUseCloudFeatures().then(setCloudSync);
    void getPriceAlertSettings().then((s) => setGlobalNotificationsEnabled(s.notificationsEnabled));

    const onStorageChange = (
      changes: { [key: string]: chrome.storage.StorageChange },
      areaName: string,
    ) => {
      if (areaName === 'local' && changes.priceguard_price_alert_settings) {
        void getPriceAlertSettings().then((s) =>
          setGlobalNotificationsEnabled(s.notificationsEnabled),
        );
      }
    };
    chrome.storage.onChanged.addListener(onStorageChange);
    return () => chrome.storage.onChanged.removeListener(onStorageChange);
  }, []);

  const trackLimit = premium ? PREMIUM_LIMITS.maxTrackedProducts : FREE_LIMITS.maxTrackedProducts;

  const handleAddProduct = async () => {
    const trimmed = addUrl.trim();
    if (!trimmed || addLoading || !onTrackProduct) return;

    setAddLoading(true);
    setAddError(null);
    try {
      const res = await sendRuntimeMessage<{
        ok?: boolean;
        product?: Product;
        error?: string;
      }>({
        type: 'LOAD_REVIEW_PRODUCT',
        payload: { input: trimmed },
      });

      if (!res?.ok || !res.product) {
        setAddError(res?.error ?? 'Не удалось загрузить товар');
        return;
      }

      const trackResult = await onTrackProduct(res.product);
      setAddUrl('');
      setShowAdd(false);
      if (trackResult?.kind === 'fail' || trackResult?.kind === 'limit') {
        setAddError(trackResult.kind === 'limit' ? 'Лимит товаров' : 'Не удалось добавить товар');
      }
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Не удалось добавить товар');
      toastError('Не удалось добавить товар');
    } finally {
      setAddLoading(false);
    }
  };

  const addProductBlock = onTrackProduct ? (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <SectionLabel>Отслеживаемые</SectionLabel>
        <Button
          size="sm"
          variant="outline"
          className="gap-1 border-primary/30 text-primary hover:bg-primary/5"
          onClick={() => setShowAdd((v) => !v)}
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
          Добавить товар
        </Button>
      </div>
      {showAdd && (
        <Surface variant="subtle" padding="sm" className="space-y-2">
          <div className="flex gap-2">
            <input
              type="text"
              value={addUrl}
              onChange={(e) => {
                setAddUrl(e.target.value);
                if (addError) setAddError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handleAddProduct();
                }
              }}
              placeholder="Ссылка или артикул (WB, Ozon, Маркет)"
              aria-label="Ссылка на товар"
              disabled={addLoading}
              className="min-w-0 flex-1 rounded-sm border-0 bg-background px-2.5 py-2 pg-body outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
            />
            <Button
              size="sm"
              className="shrink-0"
              disabled={addLoading || !addUrl.trim()}
              onClick={() => void handleAddProduct()}
            >
              {addLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Добавить'}
            </Button>
          </div>
          {addError ? <p className="pg-caption text-destructive">{addError}</p> : null}
          {trackLimit != null && products.length >= trackLimit && (
            <p className="pg-caption">
              Лимит {premium ? 'Premium' : 'Free'}: {trackLimit} товаров.
              {!premium && onOpenPremium && (
                <>
                  {' '}
                  <button type="button" className="text-primary underline" onClick={onOpenPremium}>
                    Premium
                  </button>
                </>
              )}
            </p>
          )}
        </Surface>
      )}
    </div>
  ) : null;

  const footer = (
    <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
      <p className="inline-flex items-center gap-1.5 pg-hint">
        {globalNotificationsEnabled ? (
          <>
            <Bell className="h-3.5 w-3.5 text-primary" strokeWidth={1.75} aria-hidden />
            Уведомления включены
          </>
        ) : (
          <>
            <BellOff className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.75} aria-hidden />
            Уведомления выключены
          </>
        )}
      </p>
      {products.length > 0 && (
        <button
          type="button"
          className="inline-flex items-center gap-1 pg-hint font-medium text-foreground hover:text-primary"
          onClick={() => setCollapseAllSignal((n) => n + 1)}
        >
          Свернуть все
          <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
        </button>
      )}
    </div>
  );

  if (products.length === 0) {
    return (
      <div className="space-y-3">
        {!cloudSync && <CloudSyncBanner onOpenAuth={onOpenAuth} />}
        {addProductBlock}
        <div className="flex items-center justify-end">
          {onRefresh && (
            <Button
              size="sm"
              variant="ghost"
              className="gap-1.5"
              disabled={refreshing}
              onClick={() => void onRefresh()}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              Обновить
            </Button>
          )}
        </div>
        <EmptyState
          icon={PackageSearch}
          title="Нет отслеживаемых товаров"
          description="Добавьте товар по ссылке или откройте карточку и включите «Следить за ценой». С Telegram сервер следит за ценой даже без открытого Chrome."
          className="py-12"
        >
          <div className="mt-3 w-full max-w-[260px]">
            <TelegramChannelLink variant="outline" />
          </div>
        </EmptyState>
        {footer}
      </div>
    );
  }

  const selected = selectedId ? products.find((p) => p.id === selectedId) : undefined;

  return (
    <div className="space-y-3">
      {!cloudSync && <CloudSyncBanner onOpenAuth={onOpenAuth} />}
      {!globalNotificationsEnabled && (
        <Surface variant="subtle" padding="sm" className="flex items-start gap-2.5 bg-amber-500/10">
          <BellOff className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" />
          <div className="min-w-0 flex-1">
            <p className="pg-body font-medium text-amber-950 dark:text-amber-100">
              Уведомления о падении цены выключены
            </p>
            <p className="pg-hint mt-0.5 text-amber-900/70 dark:text-amber-200/70">
              Включите в Настройках — иначе push и Telegram не придут
            </p>
          </div>
          {onOpenSettings && (
            <Button size="sm" variant="ghost" className="shrink-0" onClick={onOpenSettings}>
              <Settings className="mr-1 h-3 w-3" />
              Настройки
            </Button>
          )}
        </Surface>
      )}

      {addProductBlock ?? (
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <SectionLabel>Отслеживание</SectionLabel>
            {trackLimit != null ? (
              <p className="pg-hint truncate">
                Отслеживается {products.length} из {trackLimit} товаров
                {!premium && products.length >= trackLimit && ' · Premium — до 50'}
              </p>
            ) : (
              <p className="pg-hint">Отслеживается {products.length} товаров</p>
            )}
          </div>
        </div>
      )}

      {addProductBlock && (
        <p className="pg-hint">
          {trackLimit != null
            ? `Отслеживается ${products.length} из ${trackLimit} товаров`
            : `Отслеживается ${products.length} товаров`}
        </p>
      )}

      <div className="flex justify-end">
        {onRefresh && (
          <Button
            size="sm"
            variant="outline"
            className="shrink-0 gap-1.5"
            disabled={refreshing}
            onClick={() => void onRefresh()}
            title="Синхронизировать с облаком и обновить список"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            Обновить
          </Button>
        )}
      </div>

      <TrackedSwitcher
        products={products}
        selectedId={selectedId}
        onSelect={onSelect}
        onRemove={onRemove}
        removingId={removingTrackedId}
      />

      {selected && (
        <AuthenticityHint marketplace={selected.marketplace} authenticity={selected.authenticity} />
      )}

      <TrackedList
        products={products}
        priceHistory={priceHistory}
        selectedId={selectedId}
        globalNotificationsEnabled={globalNotificationsEnabled}
        onSelect={onSelect}
        onRemove={onRemove}
        onNotificationsChange={onNotificationsChange}
        collapseAllSignal={collapseAllSignal}
      />

      {footer}
    </div>
  );
}

function CloudSyncBanner({ onOpenAuth }: { onOpenAuth?: () => void }) {
  return (
    <Surface variant="subtle" padding="sm" className="flex items-start gap-2.5">
      <CloudOff className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="pg-body font-medium">Данные только на этом устройстве</p>
        <p className="pg-hint mt-0.5">
          Войдите в аккаунт — список синхронизируется между браузерами
        </p>
      </div>
      {onOpenAuth && (
        <Button size="sm" variant="outline" className="shrink-0" onClick={onOpenAuth}>
          <LogIn className="mr-1 h-3 w-3" />
          Войти
        </Button>
      )}
    </Surface>
  );
}
