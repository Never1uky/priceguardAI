import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  CHECKOUT_PLAN_IDS,
  FREE_LIMITS,
  PREMIUM_PLANS,
  TRIAL_DAYS,
  type CheckoutPlanId,
} from '@/types/subscription';
import {
  canStartTrial,
  getSubscription,
  isPremium,
  startTrial,
} from '@/lib/subscription';
import {
  checkPendingPayment,
  getPendingPayment,
  startCheckout,
} from '@/lib/subscription/payments';
import { isSupabaseConfigured } from '@/lib/supabase/client';
import { canUseCloudFeatures, AI_AUTH_REQUIRED_MESSAGE } from '@/lib/supabase/auth-guard';
import {
  Check,
  CreditCard,
  Crown,
  LogIn,
  Loader2,
  Sparkles,
  X,
  Zap,
} from 'lucide-react';
import { useEffect, useState } from 'react';

const PREMIUM_FEATURES = [
  'Неограниченный AI-анализ товаров',
  'Полный разбор: плюсы, минусы, альтернативы',
  'Неограниченное отслеживание товаров',
  'Алерты о цене + приоритет проверки (без Chrome)',
  'Сравнение по всем маркетплейсам · где дешевле',
];

const FREE_FEATURES = [
  `${FREE_LIMITS.maxAiRequestsPerDay} полных AI-анализов в сутки (после входа)`,
  `До ${FREE_LIMITS.maxTrackedProducts} отслеживаемых товаров`,
  'Алерты о падении цены (Telegram + AI по ссылке)',
  'Сравнение цен · где дешевле на маркетплейсах',
];

interface SubscriptionModalProps {
  open: boolean;
  onClose: () => void;
  onSubscribed?: () => void;
  onOpenAuth?: () => void;
  reason?: string;
}

export function SubscriptionModal({
  open,
  onClose,
  onSubscribed,
  onOpenAuth,
  reason,
}: SubscriptionModalProps) {
  const [selectedPlan, setSelectedPlan] = useState<CheckoutPlanId>('yearly');
  const [trialAvailable, setTrialAvailable] = useState(false);
  const [isPaying, setIsPaying] = useState(false);
  const [isStartingTrial, setIsStartingTrial] = useState(false);
  const [isCheckingPayment, setIsCheckingPayment] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [hasPendingPayment, setHasPendingPayment] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const supabaseReady = isSupabaseConfigured();

  useEffect(() => {
    if (!open) return;
    void (async () => {
      const [canTrial, pending, premium, authed] = await Promise.all([
        canStartTrial(),
        getPendingPayment(),
        isPremium(),
        canUseCloudFeatures(),
      ]);
      setTrialAvailable(canTrial && !premium);
      setHasPendingPayment(Boolean(pending));
      setIsAuthenticated(authed);
      setMessage(reason ?? null);
    })();
  }, [open, reason]);

  if (!open) return null;

  const handleTrial = async () => {
    if (!isAuthenticated) {
      setMessage(AI_AUTH_REQUIRED_MESSAGE);
      onOpenAuth?.();
      return;
    }
    setIsStartingTrial(true);
    setMessage(null);
    const result = await startTrial();
    if (result.ok) {
      setMessage(`Пробный Premium активен на ${TRIAL_DAYS} дней!`);
      onSubscribed?.();
      setTimeout(onClose, 1200);
    } else {
      setMessage(result.error ?? 'Не удалось активировать пробный период');
    }
    setIsStartingTrial(false);
  };

  const handlePay = async () => {
    setIsPaying(true);
    setMessage(null);
    const result = await startCheckout(selectedPlan);
    if (result.ok) {
      setMessage('Страница оплаты открыта. После оплаты нажмите «Проверить оплату».');
      setHasPendingPayment(true);
    } else {
      setMessage(result.error ?? 'Ошибка оплаты');
    }
    setIsPaying(false);
  };

  const handleCheckPayment = async () => {
    setIsCheckingPayment(true);
    const { activateLicenseKey } = await import('@/lib/subscription');
    const result = await checkPendingPayment();
    if (result.licenseKey) {
      const activated = await activateLicenseKey(result.licenseKey);
      if (activated.ok) {
        setMessage('Оплата подтверждена! Premium активирован.');
        onSubscribed?.();
        setTimeout(onClose, 1200);
      } else {
        setMessage(`Ключ: ${result.licenseKey}`);
      }
    } else {
      setMessage(result.error ?? `Статус: ${result.status ?? 'ожидание'}`);
    }
    setIsCheckingPayment(false);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-3 backdrop-blur-sm sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="subscription-modal-title"
    >
      <div className="relative max-h-[92vh] w-full max-w-md overflow-y-auto rounded-2xl border border-border bg-card text-card-foreground shadow-2xl">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 rounded-full p-1.5 text-muted-foreground hover:bg-muted"
          aria-label="Закрыть"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="border-b border-border/60 bg-purple/5 p-5 pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-sm bg-purple/15">
              <Crown className="h-5 w-5 text-purple" strokeWidth={1.75} />
            </div>
            <div>
              <h2 id="subscription-modal-title" className="pg-title">
                PriceGuard Premium
              </h2>
              <p className="pg-hint mt-0.5">
                AI-анализ без лимитов и все функции
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-4 p-5">
          {!isAuthenticated && (
            <div className="rounded-sm bg-primary/10 p-3">
              <p className="pg-body">{AI_AUTH_REQUIRED_MESSAGE}</p>
              {onOpenAuth && (
                <Button size="sm" className="mt-2" onClick={onOpenAuth}>
                  <LogIn className="h-3.5 w-3.5" strokeWidth={1.75} />
                  Войти
                </Button>
              )}
            </div>
          )}

          {trialAvailable && isAuthenticated && (
            <Button
              size="lg"
              variant="purple"
              className="w-full"
              onClick={() => void handleTrial()}
              disabled={isStartingTrial}
            >
              {isStartingTrial ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" strokeWidth={1.75} />
              )}
              Начать бесплатный {TRIAL_DAYS}-дневный период
            </Button>
          )}

          <div className="grid grid-cols-2 gap-2">
            {CHECKOUT_PLAN_IDS.map((planId) => {
              const plan = PREMIUM_PLANS[planId];
              const selected = selectedPlan === planId;
              return (
                <button
                  key={planId}
                  type="button"
                  onClick={() => setSelectedPlan(planId)}
                  className={`relative rounded-sm p-3 text-left pg-transition ${
                    selected
                      ? 'bg-purple/10 ring-1 ring-purple/40'
                      : 'bg-muted/40 hover:bg-muted/70'
                  }`}
                >
                  {plan.highlight && (
                    <Badge variant="success" className="absolute -top-2 right-2">
                      −{plan.savingsPercent}%
                    </Badge>
                  )}
                  <p className="pg-subtitle">{plan.label}</p>
                  <p className="mt-1 text-xl font-semibold tabular-nums text-foreground">
                    {plan.priceRub} ₽
                  </p>
                  <p className="pg-caption mt-0.5">
                    {planId === 'yearly' && 'monthlyEquivalentRub' in plan
                      ? `≈ ${plan.monthlyEquivalentRub} ₽/мес`
                      : `за ${plan.period}`}
                  </p>
                </button>
              );
            })}
          </div>

          <Button
            size="lg"
            variant="purple"
            className="w-full"
            onClick={() => void handlePay()}
            disabled={isPaying || !supabaseReady}
          >
            {isPaying ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CreditCard className="h-4 w-4" strokeWidth={1.75} />
            )}
            Оплатить {PREMIUM_PLANS[selectedPlan].priceRub} ₽
          </Button>

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

          {!supabaseReady && (
            <p className="text-center text-[10px] text-amber-600">
              Для оплаты настройте Supabase и ЮKassa (docs/SUPABASE.md)
            </p>
          )}

          <div className="grid grid-cols-2 gap-3 rounded-xl border border-border bg-muted/20 p-3">
            <div>
              <p className="mb-2 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                <Zap className="h-3 w-3 text-amber-500" /> Premium
              </p>
              <ul className="space-y-1.5">
                {PREMIUM_FEATURES.slice(0, 4).map((f) => (
                  <li key={f} className="flex gap-1.5 text-[10px] text-foreground">
                    <Check className="mt-0.5 h-3 w-3 shrink-0 text-green-500" />
                    {f}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                Free
              </p>
              <ul className="space-y-1.5">
                {FREE_FEATURES.map((f) => (
                  <li key={f} className="text-[10px] text-muted-foreground">• {f}</li>
                ))}
              </ul>
            </div>
          </div>

          {message && (
            <p className="rounded-lg border border-border bg-muted/40 p-2.5 text-xs text-foreground">
              {message}
            </p>
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
        </div>
      </div>
    </div>
  );
}

/** Показать модалку, если пробный период истёк */
export async function shouldPromptSubscription(): Promise<boolean> {
  const sub = await getSubscription();
  if (sub.tier !== 'free') return false;
  return (await import('@/lib/subscription')).hasUsedTrial();
}
