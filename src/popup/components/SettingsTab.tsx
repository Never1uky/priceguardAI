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
import { isAuthenticated } from '@/lib/supabase/auth';
import type { UiTheme } from '@/lib/ui-theme';
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
  Sun,
  Wifi,
  XCircle,
} from 'lucide-react';
import { useEffect, useState } from 'react';

import { isPremium } from '@/lib/subscription';
import {
  isServerPriceMonitoringActive,
  pullAlertSettingsFromCloud,
  syncAlertSettingsToCloud,
} from '@/lib/supabase/alert-settings-sync';
import { sendTelegramPriceAlert } from '@/lib/telegram-price-alert';

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

  const load = async () => {
    const [prem, alerts, dev, monitoring, loggedIn] = await Promise.all([
      isPremium(),
      getPriceAlertSettings(),
      isDeveloperUser(),
      isServerPriceMonitoringActive(),
      isAuthenticated(),
    ]);
    setPremium(prem);
    setAlertSettings(alerts);
    setIsDev(dev);
    setServerMonitoring(monitoring);
    setAuthed(loggedIn);

    // После reinstall: подтянуть Chat ID с аккаунта
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

  const handleConnectTelegram = async () => {
    if (!alertSettings) return;
    setTelegramBusy(true);
    setTelegramStatus(null);

    const chatId = alertSettings.telegramChatId.trim();
    if (!chatId) {
      setTelegramStatus('Укажите Chat ID (команда /chatid у бота) и повторите.');
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
      listSynced = await syncTrackedProductsWithCloud();
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
    });

    if (!sync?.ok || !sync.serverMonitoring) {
      setTelegramStatus(
        [
          'Сервер не включён.',
          sync?.error ? `Причина: ${sync.error}` : null,
          'Проверьте: вход в «Аккаунт» на этом Mac, Telegram Вкл, Chat ID, интернет.',
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
                  className="w-full rounded-sm border-0 bg-muted/60 px-2.5 py-2 pg-body outline-none ring-primary focus:ring-1"
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
                  className="w-full rounded-sm border-0 bg-muted/60 px-2.5 py-2 pg-body outline-none ring-primary focus:ring-1"
                />
              </label>
            </div>
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
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="pg-body font-medium">Уведомления в Telegram</p>
              <p className="pg-caption text-muted-foreground">Сервер + backup в Chrome при устаревших ценах</p>
            </div>
            <button
              type="button"
              disabled={alertSettings?.notificationsEnabled === false}
              onClick={() => {
                const next = !(alertSettings?.telegramEnabled ?? false);
                void savePriceAlertSettings(
                  { telegramEnabled: next },
                  { clearTelegram: !next },
                ).then(setAlertSettings);
                if (!next) setServerMonitoring(false);
              }}
              className={`rounded-full px-2.5 py-1 pg-caption font-medium pg-transition ${
                alertSettings?.telegramEnabled ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
              }`}
            >
              {alertSettings?.telegramEnabled ? 'Вкл' : 'Выкл'}
            </button>
          </div>
          <input
            type="text"
            placeholder="Chat ID, например 123456789"
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
              void savePriceAlertSettings(
                { telegramChatId: alertSettings.telegramChatId },
                { clearTelegram: chatId.length === 0 },
              ).then(setAlertSettings);
            }}
            className="w-full rounded-sm border-0 bg-muted/60 px-2.5 py-2 pg-body outline-none ring-primary focus:ring-1"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              className="gap-1.5 text-[11px]"
              disabled={telegramBusy || alertSettings?.notificationsEnabled === false}
              onClick={() => void handleConnectTelegram()}
            >
              {telegramBusy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} />
              ) : (
                <Send className="h-3.5 w-3.5" strokeWidth={1.75} />
              )}
              Подключить и проверить
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 text-[11px]"
              disabled={telegramBusy || !alertSettings?.telegramChatId?.trim()}
              onClick={() => {
                void (async () => {
                  setTelegramBusy(true);
                  const saved = await savePriceAlertSettings(
                    { telegramEnabled: false, telegramChatId: '' },
                    { clearTelegram: true },
                  );
                  setAlertSettings(saved);
                  setServerMonitoring(false);
                  setTelegramStatus('Telegram отключён, привязка Chat ID снята с аккаунта.');
                  setTelegramBusy(false);
                })();
              }}
            >
              Отключить
            </Button>
            <Badge variant={authed ? 'success' : 'secondary'} className="text-[10px]">
              Аккаунт: {authed ? 'Вход' : 'Нет'}
            </Badge>
            <Badge variant={serverMonitoring ? 'success' : 'secondary'} className="text-[10px]">
              Сервер: {serverMonitoring ? 'Вкл' : 'Выкл'}
            </Badge>
          </div>
          {telegramStatus && (
            <p className="rounded-sm bg-muted/60 px-2.5 py-2 pg-caption leading-relaxed text-foreground">
              {telegramStatus}
            </p>
          )}
          <p className="pg-caption leading-relaxed text-muted-foreground">
            {authed
              ? 'Бот @PriceGuardAlertsBot: алерты о цене и AI по ссылке на товар. /start → Chat ID → Вкл → «Подключить». Free — до 5 товаров; Premium — без лимита и приоритет. Chrome для алертов не обязателен.'
              : 'Сначала войдите во вкладку «Аккаунт» на этом устройстве — без входа Chat ID не привяжется к серверу.'}
          </p>
        </Surface>
      </section>

      {isDev && (
        <section className="space-y-2">
          <SectionLabel>Dev</SectionLabel>
          <Surface variant="raised" className="space-y-3 p-3">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-sm bg-purple/10 text-purple">
                <Sparkles className="h-[18px] w-[18px]" strokeWidth={1.75} />
              </div>
              <div>
                <p className="pg-body font-medium">AI и метрики</p>
                <p className="pg-caption text-muted-foreground">
                  AI сегодня: {quota.used} / {premium ? '∞' : quota.limit}
                </p>
              </div>
            </div>
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
          </Surface>
        </section>
      )}
    </div>
  );
}
