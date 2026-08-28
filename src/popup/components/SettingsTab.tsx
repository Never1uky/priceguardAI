import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SectionLabel } from '@/components/ui/section-label';
import { Surface } from '@/components/ui/surface';
import {
  loadAiApiSettings,
  saveAiApiSettings,
  testAiConnection,
  type AiPriority,
} from '@/api/ai';
import { getAiQuotaStats, FREE_DAILY_AI_LIMIT } from '@/lib/api/ai-quota';
import { getPriceAlertSettings, type PriceAlertSettings } from '@/lib/compare-price-alerts';
import { savePriceAlertSettings } from '@/lib/notification-settings';
import { isDeveloperUser } from '@/lib/developer-access';
import { getAuthUser, isAuthenticated } from '@/lib/supabase/auth';
import { RUNNING_IDS_KEY, RUNNING_KEY, SEARCHING_MP_KEY } from '@/lib/compare-jobs';
import { normalizeRunningIds } from '@/lib/compare-running-state';
import type { UiTheme } from '@/lib/ui-theme';
import {
  diagnosticsJsonString,
  ensureSessionId,
  loadTelemetrySettings,
  saveTelemetrySettings,
  countTelemetryByLevel,
  getSessionIdSync,
  type TelemetryMode,
} from '@/lib/telemetry';
import {
  trackTelegramConnectStarted,
  trackTelegramDisconnected,
} from '@/lib/telemetry/funnel';
import { pipelineMetrics } from '@/lib/pipeline-metrics';
import { getSupabaseConfig } from '@/lib/supabase/config';
import {
  Scale,
  Bell,
  BellOff,
  BarChart3,
  CheckCircle2,
  Cloud,
  Crown,
  Headphones,
  Loader2,
  Mail,
  Moon,
  Save,
  Send,
  ShieldCheck,
  Sparkles,
  Star,
  Sun,
  Wifi,
  XCircle,
  ChevronDown,
  ExternalLink,
} from 'lucide-react';
import {
  MARKETPLACES,
  type MarketplaceId,
} from '@/lib/marketplaces/registry';
import {
  getSelectedSearchMarketplaces,
  saveSearchMarketplacesSettings,
} from '@/lib/marketplaces/search-settings';
import {
  isServerCompareEnabled,
  loadServerMarketplaceFlags,
  type ServerMarketplaceFlagsMap,
} from '@/lib/marketplaces/server-flags';
import { useEffect, useState } from 'react';

import {
  getReviewUrlForCurrentBrowser,
  TELEGRAM_CHANNEL_URL,
  TELEGRAM_CHANNEL_LINK_LABEL,
} from '@/lib/chrome-store';
import { isPremium } from '@/lib/subscription';
import {
  isServerPriceMonitoringActive,
  pullAlertSettingsFromCloud,
  syncAlertSettingsToCloud,
} from '@/lib/supabase/alert-settings-sync';
import { sendTelegramPriceAlert } from '@/lib/telegram-price-alert';
import { TelegramChannelLink } from '@/popup/components/TelegramChannelLink';
import {
  CLOUD_NETWORK_WARN_MESSAGE,
  CLOUD_NETWORK_WARN_STORAGE_KEY,
  clearCloudNetworkWarning,
  getCloudNetworkWarning,
  isCloudNetworkError,
  noteCloudNetworkFailure,
} from '@/lib/supabase/cloud-reachability';

const PRIVACY_POLICY_URL = 'https://priceguard-landing.vercel.app/privacy';
const ACCOUNT_DELETION_MAIL =
  'mailto:priceguardAlsupp0rt@yandex.ru?subject=%D0%A3%D0%B4%D0%B0%D0%BB%D0%B5%D0%BD%D0%B8%D0%B5%20%D0%B4%D0%B0%D0%BD%D0%BD%D1%8B%D1%85';

interface SettingsTabProps {
  onOpenPremium?: () => void;
  theme?: UiTheme;
  onThemeChange?: (theme: UiTheme) => void;
}

async function openMetricsAdminPage(): Promise<void> {
  const authed = await isAuthenticated();
  if (!authed) {
    window.alert('Дашборд метрик доступен только после входа под email разработчика.');
    return;
  }
  const url = chrome.runtime.getURL('src/admin/index.html');
  void chrome.tabs.create({ url });
}

function ProviderCard({
  label,
  subtitle,
  badge,
  selected,
  onSelect,
  gradient,
}: {
  label: string;
  subtitle: string;
  badge: string;
  selected: boolean;
  onSelect: () => void;
  gradient: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`rounded-sm p-3 text-left pg-transition ${
        selected
          ? 'bg-primary/10 text-foreground ring-1 ring-primary/30'
          : 'bg-muted/40 text-foreground hover:bg-muted/70'
      }`}
    >
      <div className={`mb-1.5 inline-flex rounded-sm px-2 py-0.5 text-[9px] font-bold text-white ${gradient}`}>
        {badge}
      </div>
      <p className="pg-body font-medium">{label}</p>
      <p className="pg-caption text-muted-foreground">{subtitle}</p>
    </button>
  );
}

export function SettingsTab({ onOpenPremium, theme = 'light', onThemeChange }: SettingsTabProps) {
  const [premium, setPremium] = useState(false);
  const [isDev, setIsDev] = useState(false);
  const [alertSettings, setAlertSettings] = useState<PriceAlertSettings | null>(null);
  const [serverMonitoring, setServerMonitoring] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [telegramBusy, setTelegramBusy] = useState(false);
  const [telegramStatus, setTelegramStatus] = useState<string | null>(null);
  const [priority, setPriority] = useState<AiPriority>('grok');
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState<AiPriority | null>(null);
  const [testResult, setTestResult] = useState<
    { ok: boolean; message: string; retryable?: boolean } | null
  >(null);
  const [quota, setQuota] = useState({
    used: 0,
    limit: FREE_DAILY_AI_LIMIT,
    remaining: FREE_DAILY_AI_LIMIT,
    serverAvailable: false,
  });
  const [devOpen, setDevOpen] = useState(false);
  const [cloudNetworkWarn, setCloudNetworkWarn] = useState(false);
  const [diagVersion, setDiagVersion] = useState('');
  const [diagEmailMask, setDiagEmailMask] = useState<string | null>(null);
  const [diagRunningId, setDiagRunningId] = useState<string | null>(null);
  const [diagSearchingMp, setDiagSearchingMp] = useState<string | null>(null);
  const [diagSessionId, setDiagSessionId] = useState('');
  const [diagTelMode, setDiagTelMode] = useState<TelemetryMode>('normal');
  const [diagRemote, setDiagRemote] = useState(false);
  const [diagCounts, setDiagCounts] = useState({ info: 0, warn: 0, error: 0 });
  const [diagPipeline, setDiagPipeline] = useState<string>('');
  const [diagSupabase, setDiagSupabase] = useState(false);
  const [diagBusy, setDiagBusy] = useState(false);
  const [diagCopyStatus, setDiagCopyStatus] = useState<string | null>(null);
  const [searchMpSelected, setSearchMpSelected] = useState<MarketplaceId[]>([]);
  const [searchMpBusy, setSearchMpBusy] = useState(false);
  const [serverMpFlags, setServerMpFlags] = useState<ServerMarketplaceFlagsMap | null>(null);

  const load = async () => {
    const [prem, alerts, dev, monitoring, loggedIn, cloudWarn, user, runningStore] =
      await Promise.all([
        isPremium(),
        getPriceAlertSettings(),
        isDeveloperUser(),
        isServerPriceMonitoringActive(),
        isAuthenticated(),
        getCloudNetworkWarning(),
        getAuthUser(),
        chrome.storage.local.get([RUNNING_KEY, RUNNING_IDS_KEY, SEARCHING_MP_KEY]),
      ]);
    setPremium(prem);
    setAlertSettings(alerts);
    setIsDev(dev);
    setServerMonitoring(monitoring);
    setAuthed(loggedIn);
    setCloudNetworkWarn(cloudWarn);
    setDiagVersion(chrome.runtime.getManifest().version);
    const email = user?.email?.trim() ?? '';
    setDiagEmailMask(
      email
        ? `${email.slice(0, 1)}***@${email.split('@')[1] ?? '…'}`
        : loggedIn
          ? '(нет email)'
          : null,
    );
    const fromIds = normalizeRunningIds(runningStore[RUNNING_IDS_KEY]);
    const runningIds = fromIds.length
      ? fromIds
      : normalizeRunningIds(runningStore[RUNNING_KEY]);
    setDiagRunningId(runningIds.length ? runningIds.join(', ') : null);
    const mp = runningStore[SEARCHING_MP_KEY];
    setDiagSearchingMp(typeof mp === 'string' ? mp : null);

    const [telSettings, sessionId, counts, metrics, searchMpSelected, serverFlags] =
      await Promise.all([
      loadTelemetrySettings(),
      ensureSessionId(),
      countTelemetryByLevel(),
      pipelineMetrics.get(),
      getSelectedSearchMarketplaces(),
      loadServerMarketplaceFlags(),
    ]);
    setDiagTelMode(telSettings.mode);
    setDiagRemote(telSettings.remoteEnabled);
    setDiagSessionId(sessionId || getSessionIdSync());
    setDiagCounts(counts);
    setDiagSupabase(getSupabaseConfig().configured);
    setDiagPipeline(
      `HB ${metrics.hiddenBrowserSuccess}/${metrics.hiddenBrowserAttempts} · API ${metrics.apiSearchSuccess} · map ${metrics.mappingHits} · AI cache ${metrics.aiCacheLocalHits + metrics.aiCacheRemoteHits}/${metrics.aiCacheMisses}`,
    );
    setSearchMpSelected(searchMpSelected);
    setServerMpFlags(serverFlags);

    // После reinstall: подтянуть привязку Telegram с аккаунта
    if (loggedIn && !alerts.telegramChatId.trim()) {
      const pulled = await pullAlertSettingsFromCloud();
      if (pulled?.restored) {
        const refreshed = await getPriceAlertSettings();
        setAlertSettings(refreshed);
        setServerMonitoring(Boolean(pulled.serverMonitoring));
      }
    }

    if (dev) {
      const [settings, stats] = await Promise.all([loadAiApiSettings(), getAiQuotaStats()]);
      setPriority(settings.priority);
      setQuota({
        used: stats.used,
        limit: stats.isPremium ? Infinity : stats.limit,
        remaining: stats.remaining,
        serverAvailable: stats.hasApiKey,
      });
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    const onStorage = (
      changes: { [key: string]: chrome.storage.StorageChange },
      area: string,
    ) => {
      if (area !== 'local' || !changes[CLOUD_NETWORK_WARN_STORAGE_KEY]) return;
      const v = changes[CLOUD_NETWORK_WARN_STORAGE_KEY].newValue as
        | { active?: boolean }
        | undefined;
      setCloudNetworkWarn(Boolean(v?.active));
    };
    chrome.storage.onChanged.addListener(onStorage);
    return () => chrome.storage.onChanged.removeListener(onStorage);
  }, []);

  const handleConnectTelegram = async () => {
    if (!alertSettings) return;
    trackTelegramConnectStarted();
    setTelegramBusy(true);
    setTelegramStatus(null);

    const chatId = alertSettings.telegramChatId.trim();
    if (!chatId) {
      setTelegramStatus('Откройте @PriceGuardAlertsBot, нажмите /start и повторите проверку.');
      setTelegramBusy(false);
      return;
    }
    const saved = await savePriceAlertSettings({
      ...alertSettings,
      telegramEnabled: true,
      telegramChatId: chatId,
      notificationsEnabled: true,
    });
    setAlertSettings(saved);

    // Перепроверяем сессию в момент клика (на Mac вход локальный, не с PC)
    const loggedInNow = await isAuthenticated();
    setAuthed(loggedInNow);
    if (!loggedInNow) {
      setTelegramStatus(
        'Войдите во вкладку «Аккаунт» на этом устройстве (сессия с PC не переносится), затем повторите «Подключить и проверить».',
      );
      setTelegramBusy(false);
      return;
    }

    const sync = await syncAlertSettingsToCloud();
    setServerMonitoring(Boolean(sync?.serverMonitoring));

    // Сразу выгрузить локальный список в облако — иначе /status в боте пустой
    let listSynced = false;
    try {
      const { syncTrackedProductsWithCloud } = await import('@/lib/storage');
      listSynced = await syncTrackedProductsWithCloud({ reconcile: true });
    } catch {
      // не блокируем подключение Telegram
    }

    const test = await sendTelegramPriceAlert({
      chatId,
      message: [
        '✅ <b>PriceGuard AI подключён</b>',
        '',
        'Вы будете получать уведомления о падении цен отслеживаемых товаров.',
        '',
        '⭐ <i>@PriceGuardAlertsBot</i>',
      ].join('\n'),
      url: TELEGRAM_CHANNEL_URL,
      buttonText: TELEGRAM_CHANNEL_LINK_LABEL,
    });

    if (!sync?.ok || !sync.serverMonitoring) {
      const networkFail =
        isCloudNetworkError(sync?.error) ||
        /failed to fetch|dns|сеть|network/i.test(String(sync?.error ?? ''));
      if (networkFail || (!sync?.ok && !sync?.error && !listSynced)) {
        noteCloudNetworkFailure('telegram-connect', sync?.error);
        setCloudNetworkWarn(true);
      }
      setTelegramStatus(
        [
          'Сервер не включён.',
          sync?.error ? `Причина: ${sync.error}` : null,
          networkFail
            ? 'Проверьте VPN/Zapret и DNS — supabase.co должен открываться.'
            : 'Проверьте: вход в «Аккаунт» на этом устройстве, Telegram включён, интернет доступен.',
          test.sent ? 'Тест-сообщение в Telegram ушло, но привязка к аккаунту не сохранилась.' : null,
        ]
          .filter(Boolean)
          .join(' '),
      );
    } else if (!test.sent) {
      setTelegramStatus(
        test.error?.includes('bot') || test.error?.includes('chat') || test.error?.includes('chat not found')
          ? `Привязка OK, но тест не прошёл: ${test.error}. Напишите @PriceGuardAlertsBot команду /start и повторите.`
          : `Привязка OK. Тест Telegram: ${test.error ?? 'ошибка'}. Напишите боту /start.`,
      );
    } else {
      clearCloudNetworkWarning();
      setCloudNetworkWarn(false);
      setTelegramStatus(
        [
          premium
            ? 'Готово: Telegram OK, серверный мониторинг Вкл (Premium · приоритет).'
            : 'Готово: Telegram OK, серверный мониторинг Вкл (Free · до 5 товаров).',
          listSynced ? 'Список синхронизирован.' : 'Откройте вкладку «Список» для синхронизации товаров.',
          'Затем в боте: /status',
        ].join(' '),
      );
    }

    setTelegramBusy(false);
    await load();
  };
  const handleSaveAi = async () => {
    await saveAiApiSettings({ priority });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    await load();
  };

  const handleTest = async (provider: AiPriority) => {
    setTesting(provider);
    setTestResult(null);
    const result = await testAiConnection(provider);
    setTestResult({ ok: result.ok, message: result.message, retryable: result.retryable });
    setTesting(null);
  };

  return (
    <div className="space-y-4">
      <Surface variant="subtle" padding="sm" className="space-y-1">
        <p className="pg-subtitle">
          v{typeof chrome !== 'undefined' ? chrome.runtime.getManifest().version : '0.9.0'}
        </p>
        <p className="pg-hint">
          Если поиск пустой — отключите VPN/adblock или выберите сервер в РФ: магазины могут
          блокировать запросы и показывать другие цены.
        </p>
      </Surface>

      <Button
        variant="ghost"
        size="sm"
        className="w-full justify-start gap-2 text-muted-foreground"
        onClick={() => {
          void chrome.tabs.create({ url: 'https://t.me/priceguard_supportbot' });
        }}
      >
        <Headphones className="h-4 w-4" strokeWidth={1.75} />
        Поддержка в Telegram
        <span className="ml-auto pg-caption">@priceguard_supportbot</span>
      </Button>

      <TelegramChannelLink variant="outline" className="w-full justify-start gap-2" />

      <Button
        variant="ghost"
        size="sm"
        className="w-full justify-start gap-2 text-muted-foreground"
        onClick={() => {
          void chrome.tabs.create({ url: 'mailto:priceguardAlsupp0rt@yandex.ru' });
        }}
      >
        <Mail className="h-4 w-4" strokeWidth={1.75} />
        Почта поддержки
        <span className="ml-auto max-w-[55%] truncate pg-caption">
          priceguardAlsupp0rt@yandex.ru
        </span>
      </Button>

      <Button
        variant="ghost"
        size="sm"
        className="w-full justify-start gap-2 text-muted-foreground"
        onClick={() => {
          void chrome.tabs.create({ url: getReviewUrlForCurrentBrowser() });
        }}
      >
        <Star className="h-4 w-4" strokeWidth={1.75} />
        Оставить отзыв
      </Button>

      <section className="space-y-2">
        <SectionLabel>Тема</SectionLabel>
        <Surface variant="raised" className="p-2">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => onThemeChange?.('light')}
              className={`flex items-center justify-center gap-2 rounded-sm px-3 py-2.5 pg-body font-medium pg-transition ${
                theme === 'light'
                  ? 'bg-primary/10 text-primary ring-1 ring-primary/30'
                  : 'text-muted-foreground hover:bg-muted/70'
              }`}
            >
              <Sun className="h-4 w-4" strokeWidth={1.75} />
              Светлая
            </button>
            <button
              type="button"
              onClick={() => onThemeChange?.('dark')}
              className={`flex items-center justify-center gap-2 rounded-sm px-3 py-2.5 pg-body font-medium pg-transition ${
                theme === 'dark'
                  ? 'bg-primary/10 text-primary ring-1 ring-primary/30'
                  : 'text-muted-foreground hover:bg-muted/70'
              }`}
            >
              <Moon className="h-4 w-4" strokeWidth={1.75} />
              Тёмная
            </button>
          </div>
        </Surface>
      </section>

      <section className="space-y-2">
        <SectionLabel>Где искать товары</SectionLabel>
        <Surface className="space-y-2 p-3">
          <p className="pg-caption text-muted-foreground">
            Выберите площадки для сравнения цен. WB, Ozon, Я.Маркет, Мегамаркет, AliExpress и М.Видео
            — по умолчанию; остальные — тестовый режим (opt-in). Больше площадок = дольше поиск
            (вкладки). Lamoda — только одежда/обувь; М.Видео включает Эльдорадо. Мониторинг/Telegram
            для Мегамаркета, AliExpress и М.Видео пока выключен.
          </p>
          <ul className="max-h-48 space-y-1.5 overflow-y-auto">
            {MARKETPLACES.map((mp) => {
              const checked = searchMpSelected.includes(mp.id);
              const isCore = mp.enabledByDefault;
              const serverOff =
                serverMpFlags != null && !isServerCompareEnabled(serverMpFlags, mp.id);
              const comingSoon = !mp.supported || !mp.capabilities.search || serverOff;
              return (
                <li key={mp.id}>
                  <label
                    className={`flex items-center justify-between gap-2 rounded-sm px-2 py-1.5 hover:bg-muted/50 ${
                      comingSoon ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
                    }`}
                  >
                    <span className="pg-caption text-foreground">
                      {mp.name}
                      {comingSoon ? (
                        <span className="ml-1 text-muted-foreground">
                          {serverOff ? 'на сервере выкл' : 'скоро'}
                        </span>
                      ) : mp.id === 'lamoda' ? (
                        <span className="ml-1 text-muted-foreground">(одежда/обувь)</span>
                      ) : !isCore ? (
                        <span className="ml-1 text-muted-foreground">(тест)</span>
                      ) : null}
                      {!comingSoon && mp.capabilities.costTier === 'tab' ? (
                        <span className="ml-1 text-muted-foreground">· вкладка</span>
                      ) : null}
                    </span>
                    <input
                      type="checkbox"
                      className="shrink-0"
                      checked={checked && !comingSoon}
                      disabled={
                        comingSoon || searchMpBusy || (checked && searchMpSelected.length <= 1)
                      }
                      aria-label={mp.name}
                      onChange={() => {
                        if (comingSoon) return;
                        void (async () => {
                          setSearchMpBusy(true);
                          const next = checked
                            ? searchMpSelected.filter((id) => id !== mp.id)
                            : [...searchMpSelected, mp.id];
                          const saved = await saveSearchMarketplacesSettings(next);
                          setSearchMpSelected(saved.selected);
                          setSearchMpBusy(false);
                        })();
                      }}
                    />
                  </label>
                </li>
              );
            })}
          </ul>
          <p className="pg-hint text-muted-foreground">
            Сейчас: {searchMpSelected.length} площад
            {searchMpSelected.length === 1 ? 'ка' : searchMpSelected.length < 5 ? 'ки' : 'ок'}
          </p>
          {searchMpSelected.length >= 5 && (
            <p className="pg-hint text-amber-700 dark:text-amber-300" role="status">
              Выбрано много площадок — сравнение займёт дольше (вкладки и ожидание). Для
              быстрой проверки оставьте 3–4.
            </p>
          )}
        </Surface>
      </section>

      <section className="space-y-2">
        <SectionLabel>Подписка</SectionLabel>
        <Surface variant="raised" className="flex items-center gap-3 p-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm bg-purple/10 text-purple">
            <Crown className="h-[18px] w-[18px]" strokeWidth={1.75} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="pg-body font-medium">PriceGuard AI</p>
            <p className="pg-caption text-muted-foreground">
              {premium ? 'Premium активен' : 'Бесплатный тариф'}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <Badge variant={premium ? 'purple' : 'secondary'} className="text-[10px]">
              {premium ? 'Premium' : 'Бесплатно'}
            </Badge>
            {!premium && onOpenPremium && (
              <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={onOpenPremium}>
                Оформить
              </Button>
            )}
          </div>
        </Surface>
      </section>

      <section className="space-y-2">
        <SectionLabel>Уведомления</SectionLabel>
        <Surface variant="raised" className="divide-y divide-border/50">
          <button
            type="button"
            onClick={() => {
              const next = !(alertSettings?.notificationsEnabled ?? true);
              void savePriceAlertSettings({ notificationsEnabled: next }).then(setAlertSettings);
            }}
            className="flex w-full items-center justify-between gap-3 p-3 text-left pg-transition hover:bg-muted/30"
          >
            <div>
              <p className="pg-body font-medium">Уведомления о падении цены</p>
              <p className="pg-caption text-muted-foreground">
                Для отслеживаемых товаров и целевой цены
              </p>
            </div>
            {alertSettings?.notificationsEnabled !== false ? (
              <Bell className="h-[18px] w-[18px] shrink-0 text-primary" strokeWidth={1.75} />
            ) : (
              <BellOff className="h-[18px] w-[18px] shrink-0 text-muted-foreground" strokeWidth={1.75} />
            )}
          </button>
          <div className={`space-y-3 p-3 ${alertSettings?.notificationsEnabled === false ? 'opacity-50' : ''}`}>
            <p className="pg-caption font-medium text-muted-foreground">Порог срабатывания</p>
            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1">
                <span className="pg-caption text-muted-foreground">Мин. падение, ₽</span>
                <input
                  type="number"
                  min={0}
                  disabled={alertSettings?.notificationsEnabled === false}
                  value={alertSettings?.minDropRub ?? 100}
                  onChange={(e) =>
                    setAlertSettings((prev) =>
                      prev ? { ...prev, minDropRub: Number(e.target.value) || 0 } : prev,
                    )
                  }
                  onBlur={() => {
                    if (!alertSettings) return;
                    void savePriceAlertSettings({
                      minDropRub: alertSettings.minDropRub,
                      minDropPercent: alertSettings.minDropPercent,
                    });
                  }}
                  className="w-full rounded-sm border-0 bg-muted/60 px-2.5 py-2 pg-body outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </label>
              <label className="space-y-1">
                <span className="pg-caption text-muted-foreground">Мин. падение, %</span>
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  disabled={alertSettings?.notificationsEnabled === false}
                  value={alertSettings?.minDropPercent ?? 1}
                  onChange={(e) =>
                    setAlertSettings((prev) =>
                      prev ? { ...prev, minDropPercent: Number(e.target.value) || 0 } : prev,
                    )
                  }
                  onBlur={() => {
                    if (!alertSettings) return;
                    void savePriceAlertSettings({
                      minDropRub: alertSettings.minDropRub,
                      minDropPercent: alertSettings.minDropPercent,
                    });
                  }}
                  className="w-full rounded-sm border-0 bg-muted/60 px-2.5 py-2 pg-body outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </label>
            </div>
            <p className="pg-caption text-foreground/70">
              Пришлём уведомление, если цена упадёт на указанную сумму ₽ или на указанный процент
            </p>
            <button
              type="button"
              disabled={alertSettings?.notificationsEnabled === false}
              onClick={() => {
                const next = !(alertSettings?.compareAlerts ?? true);
                void savePriceAlertSettings({ compareAlerts: next }).then(setAlertSettings);
              }}
              className={`flex w-full items-center justify-between rounded-sm px-3 py-2.5 text-left pg-transition ${
                alertSettings?.compareAlerts !== false
                  ? 'bg-purple/10'
                  : 'bg-muted/40'
              }`}
            >
              <div>
                <p className="pg-body font-medium">Уведомления при сравнении</p>
                <p className="pg-caption text-muted-foreground">Падение цены в таблице сравнения</p>
              </div>
              <Scale className={`h-4 w-4 ${alertSettings?.compareAlerts !== false ? 'text-purple' : 'text-muted-foreground'}`} strokeWidth={1.75} />
            </button>
          </div>
        </Surface>
      </section>

      <section className="space-y-2">
        <SectionLabel>Telegram</SectionLabel>
        <Surface
          variant="raised"
          className={`space-y-3 p-3 ${alertSettings?.notificationsEnabled === false ? 'opacity-50' : ''}`}
        >
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-sm bg-primary/10">
              <Send className="h-4 w-4 text-primary" strokeWidth={1.75} aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              <p className="pg-title">Telegram</p>
              <ul className="mt-1.5 space-y-0.5 pg-hint text-muted-foreground">
                <li>— Алерты о падении цены — через бота.</li>
                <li>— Разборы карточек — в канале.</li>
              </ul>
            </div>
          </div>

          <Badge
            variant={serverMonitoring ? 'success' : 'secondary'}
            className="w-full justify-start gap-1.5 whitespace-normal px-2.5 py-1.5 text-left text-[11px] font-normal leading-snug"
          >
            <span
              className={`mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full ${serverMonitoring ? 'bg-success' : 'bg-muted-foreground'}`}
              aria-hidden
            />
            {serverMonitoring && alertSettings?.telegramEnabled
              ? 'Проверка цен работает даже при закрытом Chrome'
              : 'Telegram не подключён'}
          </Badge>

          <details className="rounded-sm bg-muted/35 px-2.5 py-2">
            <summary className="cursor-pointer select-none pg-caption font-medium text-foreground/80">
              Ручная привязка Telegram (если авто-подключение не сработало)
            </summary>
            <div className="mt-2 space-y-1">
              <input
                type="text"
                placeholder="ID чата Telegram"
                aria-label="Telegram ID"
                disabled={alertSettings?.notificationsEnabled === false || !alertSettings?.telegramEnabled}
                value={alertSettings?.telegramChatId ?? ''}
                onChange={(e) =>
                  setAlertSettings((prev) =>
                    prev ? { ...prev, telegramChatId: e.target.value } : prev,
                  )
                }
                onBlur={() => {
                  if (!alertSettings) return;
                  const chatId = alertSettings.telegramChatId.trim();
                  void (async () => {
                    const saved = await savePriceAlertSettings(
                      { telegramChatId: alertSettings.telegramChatId },
                      { clearTelegram: chatId.length === 0 },
                    );
                    setAlertSettings(saved);
                    if (chatId.length === 0 && saved.cloudSyncOk === false) {
                      setTelegramStatus(
                        `Локально очищено. Сервер: ${saved.cloudSyncError ?? 'ошибка'} — войдите и нажмите «Отключить».`,
                      );
                    }
                  })();
                }}
                className="w-full rounded-sm border-0 bg-muted/60 px-2.5 py-2 pg-body outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <p className="pg-caption">Заполняйте только если подключение через кнопку не сработало.</p>
            </div>
          </details>

          <div className="flex items-center justify-between gap-3 rounded-sm bg-muted/40 px-3 py-2.5">
            <div className="min-w-0">
              <p className="pg-caption font-medium text-foreground/80">Статус</p>
              <p className="pg-hint mt-0.5">
                {alertSettings?.telegramEnabled
                  ? 'Уведомления через Telegram включены'
                  : 'Уведомления через Telegram выключены'}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              disabled={alertSettings?.notificationsEnabled === false || telegramBusy}
              aria-checked={alertSettings?.telegramEnabled ?? false}
              aria-label="Уведомления в Telegram"
              onClick={() => {
                const next = !(alertSettings?.telegramEnabled ?? false);
                void (async () => {
                  setTelegramBusy(true);
                  setTelegramStatus(null);
                  const saved = await savePriceAlertSettings(
                    { telegramEnabled: next },
                    { clearTelegram: !next, awaitCloudSync: !next },
                  );
                  setAlertSettings(saved);
                  if (!next) {
                    trackTelegramDisconnected();
                    setServerMonitoring(false);
                    if (saved.cloudSyncOk === false) {
                      setTelegramStatus(
                        `Локально выключено. Сервер: ${saved.cloudSyncError ?? 'не удалось снять привязку Telegram'} — войдите в «Аккаунт» и нажмите «Отключить».`,
                      );
                    } else {
                      setTelegramStatus('Telegram выключен, привязка Telegram снята с аккаунта.');
                    }
                  }
                  setTelegramBusy(false);
                })();
              }}
              className={`relative h-6 w-11 shrink-0 rounded-full pg-transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 ${
                alertSettings?.telegramEnabled ? 'bg-primary' : 'bg-muted-foreground/30'
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow-soft pg-transition ${
                  alertSettings?.telegramEnabled ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          <Button
            size="lg"
            className="w-full gap-1.5"
            disabled={telegramBusy || alertSettings?.notificationsEnabled === false}
            onClick={() => void handleConnectTelegram()}
          >
            {telegramBusy ? (
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
            ) : (
              <Send className="h-4 w-4" strokeWidth={1.75} />
            )}
            Подключить Telegram
          </Button>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <a
                href="https://t.me/PriceGuardAlertsBot"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 pg-hint font-medium text-primary hover:underline"
              >
                Открыть @PriceGuardAlertsBot
              </a>
              <TelegramChannelLink variant="link" />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                className="gap-1.5 text-[11px] text-muted-foreground"
                disabled={telegramBusy || !alertSettings?.telegramChatId?.trim()}
                onClick={() => {
                  void (async () => {
                    setTelegramBusy(true);
                    setTelegramStatus(null);
                    const saved = await savePriceAlertSettings(
                      { telegramEnabled: false, telegramChatId: '' },
                      { clearTelegram: true },
                    );
                    setAlertSettings(saved);
                    setServerMonitoring(false);
                    trackTelegramDisconnected();
                    if (saved.cloudSyncOk === false) {
                      setTelegramStatus(
                        `Локально отключено. Сервер: ${saved.cloudSyncError ?? 'не удалось снять привязку Telegram'} — войдите в «Аккаунт» и повторите «Отключить».`,
                      );
                    } else {
                      setTelegramStatus('Telegram отключён, привязка Telegram снята с аккаунта.');
                    }
                    setTelegramBusy(false);
                  })();
                }}
              >
                Отключить
              </Button>
            </div>
          </div>

          {cloudNetworkWarn && (
            <p
              role="status"
              className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[11px] leading-snug text-amber-900 dark:text-amber-100"
            >
              {CLOUD_NETWORK_WARN_MESSAGE}
            </p>
          )}

          <div className="flex flex-wrap gap-1.5">
            <Badge variant={authed ? 'success' : 'secondary'} className="text-[10px]">
              Аккаунт: {authed ? 'Вход' : 'Нет'}
            </Badge>
          </div>

          {telegramStatus && (
            <p
              role="status"
              aria-live="polite"
              className="rounded-sm bg-muted/60 px-2.5 py-2 pg-caption leading-relaxed text-foreground"
            >
              {telegramStatus}
            </p>
          )}
          <p className="pg-caption leading-relaxed text-muted-foreground">
            {authed
              ? 'Бот алертов: @PriceGuardAlertsBot. Нажмите /start в боте и затем «Проверить подключение». Лимиты: Free — до 5 товаров и 3 AI-разбора в день; Premium — до 50 товаров.'
              : 'Сначала войдите во вкладку «Аккаунт» на этом устройстве — без входа Telegram не привяжется к серверу.'}
          </p>
        </Surface>
      </section>

      {isDev && (
        <section className="space-y-2">
          <SectionLabel>Диагностика</SectionLabel>
          <Surface variant="raised" className="overflow-hidden">
            <button
              type="button"
              onClick={() => setDevOpen((v) => !v)}
              className="flex w-full items-center justify-between gap-3 p-3 text-left pg-transition hover:bg-muted/30"
              aria-expanded={devOpen}
            >
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm bg-purple/10 text-purple">
                  <Sparkles className="h-[18px] w-[18px]" strokeWidth={1.75} />
                </div>
                <div className="min-w-0">
                  <p className="pg-body font-medium">AI и метрики</p>
                  <p className="pg-caption text-muted-foreground">
                    AI сегодня: {quota.used} / {premium ? '∞' : quota.limit}
                  </p>
                </div>
              </div>
              <ChevronDown
                className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${devOpen ? 'rotate-180' : ''}`}
                strokeWidth={1.75}
                aria-hidden
              />
            </button>
            {devOpen && (
              <div className="space-y-3 border-t border-border/50 p-3">
            <div className="space-y-2">
              <p className="pg-caption font-medium text-muted-foreground">Приоритет AI</p>
              <div className="grid grid-cols-2 gap-2">
                <ProviderCard
                  label="Grok"
                  subtitle="x.ai — основной"
                  badge="grok-3-mini"
                  selected={priority === 'grok'}
                  onSelect={() => setPriority('grok')}
                  gradient="bg-slate-800"
                />
                <ProviderCard
                  label="GPT-4o Mini"
                  subtitle="OpenAI — запасной"
                  badge="gpt-4o-mini"
                  selected={priority === 'openai'}
                  onSelect={() => setPriority('openai')}
                  gradient="bg-emerald-600"
                />
              </div>
              <div className="flex items-center gap-1.5 text-[10px]">
                <Cloud
                  className={`h-3.5 w-3.5 ${
                    quota.serverAvailable ? 'text-success' : 'text-warning'
                  }`}
                  strokeWidth={1.75}
                />
                <span className="pg-caption text-muted-foreground">
                  {quota.serverAvailable
                    ? 'Сервер AI подключён (ключи в Supabase secrets)'
                    : 'Сервер AI недоступен'}
                </span>
              </div>
              {testResult && (
                <div
                  className={`flex items-start gap-1.5 rounded-sm px-2.5 py-2 pg-caption ${
                    testResult.ok
                      ? 'bg-success/10 text-success'
                      : 'bg-destructive/10 text-destructive'
                  }`}
                >
                  {testResult.ok ? (
                    <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0" strokeWidth={1.75} />
                  ) : (
                    <XCircle className="mt-0.5 h-3 w-3 shrink-0" strokeWidth={1.75} />
                  )}
                  <span>{testResult.message}</span>
                </div>
              )}
              <Button
                variant="outline"
                size="sm"
                className="w-full gap-1.5 text-xs"
                disabled={testing !== null}
                onClick={() => void handleTest(priority)}
              >
                {testing ? <Loader2 className="h-3 w-3 animate-spin" strokeWidth={1.75} /> : <Wifi className="h-3 w-3" strokeWidth={1.75} />}
                Проверить подключение AI
              </Button>
              <Button
                className="w-full gap-2 text-xs"
                onClick={() => void handleSaveAi()}
              >
                {saved ? (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                    Сохранено
                  </>
                ) : (
                  <>
                    <Save className="h-3.5 w-3.5" strokeWidth={1.75} />
                    Сохранить приоритет AI
                  </>
                )}
              </Button>
            </div>
            <div className="flex items-center justify-between rounded-sm bg-muted/50 px-3 py-2.5">
              <div className="flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-info" strokeWidth={1.75} />
                <div>
                  <p className="pg-body font-medium">Метрики поиска и AI</p>
                  <p className="pg-caption text-muted-foreground">vw_search_metrics_* и vw_ai_requests</p>
                </div>
              </div>
              <Button variant="ghost" size="sm" className="gap-1.5 text-xs" onClick={() => void openMetricsAdminPage()}>
                <ShieldCheck className="h-3.5 w-3.5" strokeWidth={1.75} />
                Открыть
              </Button>
            </div>
              </div>
            )}
          </Surface>
        </section>
      )}

      {isDev && (
        <details className="rounded-sm border border-border/40 bg-muted/20 px-3 py-2">
          <summary className="cursor-pointer select-none pg-caption font-medium text-muted-foreground">
            Диагностика (dev)
          </summary>
          <dl className="mt-2 space-y-1 pg-caption text-muted-foreground">
            <div className="flex justify-between gap-2">
              <dt>Версия</dt>
              <dd className="font-mono text-foreground">{diagVersion || '—'}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt>Supabase</dt>
              <dd className="text-foreground">{diagSupabase ? 'ok' : 'не настроен'}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt>Cloud network</dt>
              <dd className="text-foreground">{cloudNetworkWarn ? 'warn' : 'ok'}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt>Server monitoring</dt>
              <dd className="text-foreground">{serverMonitoring ? 'active' : 'off'}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt>Вход</dt>
              <dd className="truncate text-foreground">
                {authed ? diagEmailMask ?? 'да' : 'нет'}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt>Session</dt>
              <dd className="max-w-[55%] truncate font-mono text-foreground">
                {diagSessionId || '—'}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt>Events (i/w/e)</dt>
              <dd className="font-mono text-foreground">
                {diagCounts.info}/{diagCounts.warn}/{diagCounts.error}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt>Pipeline</dt>
              <dd className="max-w-[60%] truncate text-foreground">{diagPipeline || '—'}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt>Compare running</dt>
              <dd className="max-w-[55%] truncate font-mono text-foreground">
                {diagRunningId ?? '—'}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt>Searching MP</dt>
              <dd className="font-mono text-foreground">{diagSearchingMp ?? '—'}</dd>
            </div>
          </dl>

          <div className="mt-3 space-y-2 border-t border-border/30 pt-2">
            <p className="pg-caption font-medium text-foreground">Режим логов</p>
            <div className="flex gap-1">
              {(['silent', 'normal', 'verbose'] as TelemetryMode[]).map((mode) => (
                <Button
                  key={mode}
                  type="button"
                  size="sm"
                  variant={diagTelMode === mode ? 'default' : 'outline'}
                  className="flex-1 text-[10px]"
                  disabled={diagBusy}
                  onClick={() => {
                    void (async () => {
                      setDiagBusy(true);
                      const next = await saveTelemetrySettings({ mode });
                      setDiagTelMode(next.mode);
                      setDiagBusy(false);
                    })();
                  }}
                >
                  {mode}
                </Button>
              ))}
            </div>
            <label className="flex items-center justify-between gap-2 rounded-sm bg-muted/40 px-2 py-1.5">
              <span className="pg-caption text-foreground">
                Облако: WARN/ERROR и анонимная воронка (та же настройка)
              </span>
              <input
                type="checkbox"
                checked={diagRemote}
                disabled={diagBusy}
                onChange={(e) => {
                  const enabled = e.target.checked;
                  void (async () => {
                    setDiagBusy(true);
                    const next = await saveTelemetrySettings({ remoteEnabled: enabled });
                    setDiagRemote(next.remoteEnabled);
                    setDiagBusy(false);
                  })();
                }}
              />
            </label>
            <div className="flex flex-col gap-1.5">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="w-full text-xs"
                disabled={diagBusy}
                onClick={() => {
                  void (async () => {
                    setDiagBusy(true);
                    setDiagCopyStatus(null);
                    try {
                      const json = await diagnosticsJsonString();
                      await navigator.clipboard.writeText(json);
                      setDiagCopyStatus('Скопировано в буфер');
                    } catch {
                      setDiagCopyStatus('Не удалось скопировать');
                    }
                    setDiagBusy(false);
                  })();
                }}
              >
                Copy diagnostics
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="w-full text-xs"
                disabled={diagBusy}
                onClick={() => {
                  void (async () => {
                    setDiagBusy(true);
                    setDiagCopyStatus(null);
                    try {
                      const json = await diagnosticsJsonString();
                      const blob = new Blob([json], { type: 'application/json' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `priceguard-diagnostics-${Date.now()}.json`;
                      a.click();
                      URL.revokeObjectURL(url);
                      setDiagCopyStatus('Файл diagnostics.json скачан');
                    } catch {
                      setDiagCopyStatus('Не удалось экспортировать');
                    }
                    setDiagBusy(false);
                  })();
                }}
              >
                Export diagnostics.json
              </Button>
              {diagCopyStatus && (
                <p className="pg-caption text-muted-foreground">{diagCopyStatus}</p>
              )}
            </div>
          </div>
        </details>
      )}

      <section className="space-y-2 border-t border-border/40 pt-3">
        <SectionLabel>Конфиденциальность</SectionLabel>
        <Surface className="space-y-2 p-3">
          <a
            href={PRIVACY_POLICY_URL}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-between gap-2 rounded-sm px-1 py-1 text-xs font-medium text-foreground hover:bg-muted/50"
          >
            <span>Политика конфиденциальности</span>
            <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={1.75} />
          </a>
          <label className="flex items-start justify-between gap-3 rounded-sm bg-muted/40 px-2 py-2">
            <span className="pg-caption text-foreground">
              Анонимная аналитика продукта — воронка сравнений, AI и Premium без URL и названия товара.
              Можно выключить в любой момент.
            </span>
            <input
              type="checkbox"
              className="mt-0.5 shrink-0"
              checked={diagRemote}
              disabled={diagBusy}
              aria-label="Анонимная аналитика продукта"
              onChange={(e) => {
                const enabled = e.target.checked;
                void (async () => {
                  setDiagBusy(true);
                  const next = await saveTelemetrySettings({ remoteEnabled: enabled });
                  setDiagRemote(next.remoteEnabled);
                  setDiagBusy(false);
                })();
              }}
            />
          </label>
          <a
            href={ACCOUNT_DELETION_MAIL}
            className="block rounded-sm px-1 py-1 pg-caption text-muted-foreground hover:bg-muted/50 hover:text-foreground"
          >
            Запрос на удаление данных — priceguardAlsupp0rt@yandex.ru
          </a>
          {!isDev && (
            <div className="space-y-1.5 border-t border-border/30 pt-2">
              <p className="pg-caption text-muted-foreground">
                При сбое скачайте отчёт и приложите к письму в поддержку. Без промптов и паролей.
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="w-full text-xs"
                disabled={diagBusy}
                onClick={() => {
                  void (async () => {
                    setDiagBusy(true);
                    setDiagCopyStatus(null);
                    try {
                      const json = await diagnosticsJsonString();
                      const blob = new Blob([json], { type: 'application/json' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `priceguard-diagnostics-${Date.now()}.json`;
                      a.click();
                      URL.revokeObjectURL(url);
                      setDiagCopyStatus('Отчёт скачан — приложите к письму в поддержку');
                    } catch {
                      setDiagCopyStatus('Не удалось скачать отчёт');
                    }
                    setDiagBusy(false);
                  })();
                }}
              >
                Скачать отчёт для поддержки
              </Button>
              {diagCopyStatus && (
                <p className="pg-caption text-muted-foreground">{diagCopyStatus}</p>
              )}
            </div>
          )}
        </Surface>
      </section>
    </div>
  );
}
