import { TrackedList } from '@/popup/components/TrackedList';
import { TrackedSwitcher } from '@/popup/components/TrackedSwitcher';
import { AuthenticityHint } from '@/popup/components/AuthenticityHint';
import { getPriceAlertSettings } from '@/lib/compare-price-alerts';
import { isPremium } from '@/lib/subscription';
import { canUseCloudFeatures } from '@/lib/supabase/auth-guard';
import { FREE_LIMITS } from '@/types/subscription';
import type { PricePoint, TrackedProduct } from '@/types/product';
import { BellOff, CloudOff, LogIn, RefreshCw, Settings } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { SectionLabel } from '@/components/ui/section-label';
import { Surface } from '@/components/ui/surface';
import { PackageSearch } from 'lucide-react';

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
}: TrackedTabProps) {
  const [premium, setPremium] = useState(false);
  const [cloudSync, setCloudSync] = useState(false);
  const [globalNotificationsEnabled, setGlobalNotificationsEnabled] = useState(true);

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

  const trackLimit = premium ? null : FREE_LIMITS.maxTrackedProducts;

  if (products.length === 0) {
    return (
      <div className="space-y-3">
        {!cloudSync && <CloudSyncBanner onOpenAuth={onOpenAuth} />}
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
          description="Откройте карточку и нажмите «Отслеживать» на вкладке «Цены и сравнение». С Telegram сервер следит за ценой даже без открытого Chrome."
          className="py-12"
        />
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

      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <SectionLabel>Отслеживание</SectionLabel>
          {trackLimit != null ? (
          <p className="pg-hint truncate">
            Отслеживается {products.length} из {trackLimit} товаров
            {products.length >= trackLimit && ' · Premium — без лимита'}
          </p>
        ) : (
          <p className="pg-hint">Отслеживается {products.length} товаров</p>
        )}
        </div>
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
      />
    </div>
  );
}

function CloudSyncBanner({ onOpenAuth }: { onOpenAuth?: () => void }) {
  return (
    <Surface variant="subtle" padding="sm" className="flex items-start gap-2.5">
      <CloudOff className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="pg-body font-medium">
          Данные только на этом устройстве
        </p>
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
