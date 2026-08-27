import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SectionLabel } from '@/components/ui/section-label';
import { Surface } from '@/components/ui/surface';
import { isSupabaseConfigured } from '@/lib/supabase/client';
import { canUseCloudFeatures, AI_AUTH_REQUIRED_MESSAGE } from '@/lib/supabase/auth-guard';
import {
  activateLicenseKey,
  canStartTrial,
  deactivatePremium,
  getAiQuotaStatus,
  getSubscription,
  hasLocalTelegramForTrial,
  isTrialActive,
  startTrial,
} from '@/lib/subscription';
import {
  checkPendingPayment,
  getPendingPayment,
  startCheckout,
} from '@/lib/subscription/payments';
import { SubscriptionModal } from '@/popup/components/SubscriptionModal';
import {
  CHECKOUT_PLAN_IDS,
  FREE_LIMITS,
  PREMIUM_PLANS,
  TRIAL_DAYS,
  type CheckoutPlanId,
} from '@/types/subscription';
import type { SubscriptionState } from '@/types/subscription';
import {
  Check,
  CreditCard,
  Crown,
  KeyRound,
  LogIn,
  Loader2,
  Sparkles,
  Star,
  Zap,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { trackPremiumPageOpened } from '@/lib/telemetry/funnel';

const PREMIUM_FEATURES = [
  'Неограниченный AI-анализ товаров',
  'Глубокий разбор: AI + актуальный веб-контекст',
  'До 50 товаров в отслеживании',
  'Алерты о цене + приоритет проверки (без Chrome)',
  'Сравнение · где дешевле на всех маркетплейсах',
];

interface PremiumTabProps {
  onClose?: () => void;
  onOpenAuth?: () => void;
  /** Показать баннер «достигнут лимит Free» */
  reason?: 'limit' | null;
}

export function PremiumTab({ onClose, onOpenAuth, reason }: PremiumTabProps) {
  useEffect(() => {
    trackPremiumPageOpened();
  }, []);

  const [sub, setSub] = useState<SubscriptionState>({ tier: 'free' });
  const [licenseKey, setLicenseKey] = useState('');
  const [licenseError, setLicenseError] = useState<string | null>(null);
  const [licenseSuccess, setLicenseSuccess] = useState(false);
  const [isActivating, setIsActivating] = useState(false);
  const [isPaying, setIsPaying] = useState(false);
  const [isCheckingPayment, setIsCheckingPayment] = useState(false);
  const [isStartingTrial, setIsStartingTrial] = useState(false);
  const [paymentMessage, setPaymentMessage] = useState<string | null>(null);
  const [hasPendingPayment, setHasPendingPayment] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<CheckoutPlanId>('yearly');
  const [trialAvailable, setTrialAvailable] = useState(false);
  const [trialHasTelegram, setTrialHasTelegram] = useState(false);
  const [quotaLabel, setQuotaLabel] = useState('');
  const [showPlansModal, setShowPlansModal] = useState(false);
  const [onTrial, setOnTrial] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  const supabaseReady = isSupabaseConfigured();

  const loadState = async () => {
    const [subscription, pending, canTrial, quota, trial, authed, hasTg] = await Promise.all([
      getSubscription(),
      getPendingPayment(),
      canStartTrial(),
      getAiQuotaStatus(),
      isTrialActive(),
      canUseCloudFeatures(),
      hasLocalTelegramForTrial(),
    ]);
    setSub(subscription);
    setHasPendingPayment(Boolean(pending));
    setTrialAvailable(canTrial);
    setTrialHasTelegram(hasTg);
    setQuotaLabel(quota.label);
    setOnTrial(trial);
    setIsAuthenticated(authed);
  };

  useEffect(() => {
    void loadState();
  }, []);

  const isPremium = sub.tier === 'premium';

  const handleActivateKey = async (keyOverride?: string) => {
    if (!isAuthenticated) {
      setLicenseError(AI_AUTH_REQUIRED_MESSAGE);
      onOpenAuth?.();
      return;
    }
    const key = keyOverride ?? licenseKey;
    setIsActivating(true);
    setLicenseError(null);
    setLicenseSuccess(false);

    const result = await activateLicenseKey(key);
    if (result.ok) {
      setLicenseSuccess(true);
      setLicenseKey('');
      await loadState();
    } else {
      setLicenseError(result.error ?? 'Не удалось активировать ключ');
    }
    setIsActivating(false);
  };

  const handleTrial = async () => {
    if (!isAuthenticated) {
      setPaymentMessage(AI_AUTH_REQUIRED_MESSAGE);
      onOpenAuth?.();
      return;
    }
    setIsStartingTrial(true);
    const result = await startTrial();
    if (result.ok) {
      setPaymentMessage(`Пробный Premium активен на ${TRIAL_DAYS} дней!`);
      await loadState();
    } else {
      setPaymentMessage(result.error ?? 'Ошибка');
    }
    setIsStartingTrial(false);
  };

  const handlePay = async () => {
    if (!isAuthenticated) {
      setPaymentMessage(AI_AUTH_REQUIRED_MESSAGE);
      onOpenAuth?.();
      return;
    }
    setIsPaying(true);
    setPaymentMessage(null);
    const result = await startCheckout(selectedPlan);
    if (result.ok) {
      setPaymentMessage('Страница оплаты открыта. После оплаты нажмите «Проверить оплату».');
      setHasPendingPayment(true);
    } else {
      setPaymentMessage(result.error ?? 'Ошибка оплаты');
    }
    setIsPaying(false);
  };

  const handleCheckPayment = async () => {
    setIsCheckingPayment(true);
    setPaymentMessage(null);
    const result = await checkPendingPayment();
    if (result.licenseKey) {
      const activated = await activateLicenseKey(result.licenseKey, {
        funnelSource: 'payment',
      });
      if (activated.ok) {
        setLicenseSuccess(true);
        setPaymentMessage('Оплата подтверждена! Premium активирован.');
        await loadState();
      } else {
        setPaymentMessage(`Ключ: ${result.licenseKey} — вставьте вручную`);
        setLicenseKey(result.licenseKey);
      }
    } else {
      setPaymentMessage(result.error ?? `Статус: ${result.status ?? 'ожидание'}`);
    }
    setIsCheckingPayment(false);
  };

  const handleDeactivate = async () => {
    await deactivatePremium();
    await loadState();
  };

  return (
    <div className="space-y-3">
      {reason === 'limit' && !isPremium && (
        <Surface variant="subtle" padding="sm" className="border border-warning/30 bg-warning/10">
          <p className="pg-subtitle text-warning-foreground">
            Достигнут лимит {FREE_LIMITS.maxMyProducts} товаров (Free)
          </p>
          <p className="mt-1 pg-caption text-muted-foreground">
            Удалите товар из «Мои товары» или оформите Premium — до 50 позиций.
          </p>
        </Surface>
      )}
      <Surface variant="hero" padding="md">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-purple text-purple-foreground shadow-soft">
              <Crown className="h-6 w-6 text-white" />
            </div>
            <div className="min-w-0">
              <h2 className="pg-title">PriceGuard Premium</h2>
              <p className="pg-hint">
                {isPremium
                  ? onTrial
                    ? `Пробный период · AI: ${quotaLabel}`
                    : `Активен · AI: ${quotaLabel}`
                  : `Free · AI: ${quotaLabel}`}
              </p>
            </div>
            {isPremium && <Badge variant="purple" className="ml-auto shrink-0">PRO</Badge>}
          </div>
      </Surface>

      {!isPremium && (
        <>
          {!isAuthenticated && (
            <Surface variant="subtle" padding="sm">
              <p className="pg-body font-medium">{AI_AUTH_REQUIRED_MESSAGE}</p>
              <p className="pg-hint mt-1">
                Пробный период, оплата и активация ключа — после входа.
              </p>
              {onOpenAuth && (
                <Button size="sm" variant="outline" className="mt-2 gap-1.5" onClick={onOpenAuth}>
                  <LogIn className="h-3.5 w-3.5" />
                  Войти
                </Button>
              )}
            </Surface>
          )}

          {trialAvailable && isAuthenticated && (
            <div className="space-y-1.5">
              <Button
                variant="purple"
                size="lg"
                className="w-full gap-2 font-semibold"
                onClick={() => void handleTrial()}
                disabled={isStartingTrial || !trialHasTelegram}
              >
                {isStartingTrial ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                Начать бесплатный {TRIAL_DAYS}-дневный период
              </Button>
              <p className="pg-hint text-center">
                {trialHasTelegram
                  ? 'Бесплатный период — один раз на Telegram и устройство.'
                  : 'Бесплатный период — после подключения Telegram в Настройках.'}
              </p>
            </div>
          )}

          <div className="space-y-1.5">
            <SectionLabel>Выберите тариф</SectionLabel>
            {CHECKOUT_PLAN_IDS.map((planId) => {
              const plan = PREMIUM_PLANS[planId];
              const selected = selectedPlan === planId;
              return (
                <button
                  key={planId}
                  type="button"
                  onClick={() => setSelectedPlan(planId)}
                  className={`relative flex w-full items-center justify-between gap-3 rounded-md px-3 py-2.5 text-left pg-transition ${
                    selected
                      ? 'bg-purple/10 ring-1 ring-purple/35'
                      : 'bg-muted/35 hover:bg-muted/60'
                  }`}
                >
                  {plan.highlight && (
                    <Badge variant="success" className="shrink-0 text-[9px]">
                      −{plan.savingsPercent}%
                    </Badge>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="pg-body font-semibold">{plan.label}</p>
                    {planId === 'yearly' && 'monthlyEquivalentRub' in plan && (
                      <p className="pg-caption text-muted-foreground">≈ {plan.monthlyEquivalentRub} ₽/мес</p>
                    )}
                  </div>
                  <p className="shrink-0 text-right text-sm font-semibold text-foreground">
                    {plan.priceRub} ₽
                    <span className="pg-caption font-normal text-muted-foreground">
                      {' '}
                      / {plan.period}
                    </span>
                  </p>
                </button>
              );
            })}
          </div>

          <Button
            variant="purple"
            className="w-full gap-2 font-semibold"
            onClick={() => void handlePay()}
            disabled={isPaying || !supabaseReady}
          >
            {isPaying ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CreditCard className="h-4 w-4" />
            )}
            Оплатить {PREMIUM_PLANS[selectedPlan].priceRub} ₽
          </Button>

          <Button
            variant="outline"
            className="w-full text-xs"
            onClick={() => setShowPlansModal(true)}
          >
            Сравнить тарифы
          </Button>

          {!supabaseReady && (
            <p className="pg-hint text-center text-amber-700 dark:text-amber-300">
              Для оплаты настройте Supabase и ЮKassa (docs/SUPABASE.md).
            </p>
          )}

          {hasPendingPayment && (
            <Button
              variant="outline"
              className="w-full gap-2 text-xs"
              onClick={() => void handleCheckPayment()}
              disabled={isCheckingPayment}
            >
              {isCheckingPayment ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              Проверить оплату
            </Button>
          )}

          {paymentMessage && (
            <Surface variant="subtle" padding="sm" className="pg-caption">
              {paymentMessage}
            </Surface>
          )}

          <a
            href={
              (import.meta.env.VITE_REQUISITES_URL as string | undefined) ||
              'https://priceguard-landing.vercel.app/requisites'
            }
            target="_blank"
            rel="noopener noreferrer"
            className="block text-center text-[10px] text-muted-foreground underline-offset-2 hover:underline"
          >
            Реквизиты продавца
          </a>

          <Surface variant="subtle" padding="sm" className="space-y-2">
              <p className="flex items-center gap-1.5 pg-body font-semibold">
                <Zap className="h-3.5 w-3.5 text-purple" /> Premium включает
              </p>
              <ul className="space-y-1">
                {PREMIUM_FEATURES.map((f) => (
                  <li key={f} className="flex gap-2 pg-caption text-muted-foreground">
                    <Check className="h-3 w-3 shrink-0 text-purple" />
                    {f}
                  </li>
                ))}
              </ul>
              <p className="pt-1 pg-caption text-muted-foreground">
                Бесплатно: {FREE_LIMITS.maxAiRequestsPerDay} разбора в день
              </p>
          </Surface>

          <Surface variant="subtle" padding="sm" className="space-y-3">
              <p className="flex items-center gap-1.5 pg-body font-semibold">
                <KeyRound className="h-3.5 w-3.5" /> Активация лицензии
              </p>
              <p className="pg-hint">
                Нужен вход в аккаунт. Лицензия привязывается к аккаунту — после переустановки
                войдите снова, Premium восстановится. Если ключ потерялся, напишите в поддержку.
              </p>
              {!isAuthenticated ? (
                <Button
                  className="w-full gap-2"
                  variant="outline"
                  onClick={() => onOpenAuth?.()}
                  disabled={!onOpenAuth}
                >
                  <LogIn className="h-4 w-4" />
                  Войти, чтобы активировать ключ
                </Button>
              ) : (
                <>
                  <input
                    type="text"
                    placeholder="PGAI-XXXX-XXXX"
                    value={licenseKey}
                    onChange={(e) => setLicenseKey(e.target.value)}
                    className="w-full rounded-sm border border-border bg-background px-2 py-2 pg-body text-foreground outline-none focus:ring-1 focus:ring-purple"
                  />
                  {licenseError && <p className="text-[10px] text-red-600">{licenseError}</p>}
                  {licenseSuccess && (
                    <p className="text-[10px] text-green-600">Premium активирован!</p>
                  )}
                  <Button
                    className="w-full gap-2"
                    variant="outline"
                    onClick={() => void handleActivateKey()}
                    disabled={isActivating || !licenseKey.trim()}
                  >
                    {isActivating ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <KeyRound className="h-4 w-4" />
                    )}
                    Активировать ключ
                  </Button>
                </>
              )}
              {!isAuthenticated && licenseError && (
                <p className="text-[10px] text-red-600">{licenseError}</p>
              )}
          </Surface>
        </>
      )}

      {isPremium && (
        <Surface variant="subtle" padding="md" className="space-y-3">
            <div className="flex items-center gap-2">
              <Star className="h-5 w-5 fill-purple text-purple" />
              <p className="pg-subtitle">
                {onTrial ? 'Пробный Premium' : 'Premium активен'}
              </p>
            </div>
            {sub.expiresAt ? (
              <p className="pg-hint">
                Действует до: {new Date(sub.expiresAt).toLocaleDateString('ru-RU')}
              </p>
            ) : (
              <p className="pg-hint">Бессрочная лицензия</p>
            )}
            <p className="pg-hint">AI-анализы: {quotaLabel}</p>
            {!onTrial && (
              <p className="pg-hint">
                Лицензия привязана к аккаунту. После переустановки войдите — Premium восстановится.
              </p>
            )}
            {onTrial && (
              <Button
                variant="purple"
                className="w-full gap-2"
                onClick={() => setShowPlansModal(true)}
              >
                <CreditCard className="h-4 w-4" />
                Оформить подписку
              </Button>
            )}
            {sub.licenseKey && (
              <p className="font-mono pg-caption text-muted-foreground">Ключ: {sub.licenseKey}</p>
            )}
            <Button variant="outline" size="sm" className="text-xs" onClick={() => void handleDeactivate()}>
              Отключить Premium (тест)
            </Button>
        </Surface>
      )}

      {onClose && (
        <Button variant="outline" className="w-full text-xs" onClick={onClose}>
          Назад
        </Button>
      )}

      <SubscriptionModal
        open={showPlansModal}
        onClose={() => setShowPlansModal(false)}
        onSubscribed={() => void loadState()}
        onOpenAuth={onOpenAuth}
      />
    </div>
  );
}
