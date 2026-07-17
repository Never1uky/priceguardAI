import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScoreRing } from '@/components/ui/score-ring';
import { SectionLabel } from '@/components/ui/section-label';
import { Surface } from '@/components/ui/surface';
import { getCachedFullAnalysis } from '@/lib/full-analysis-cache';
import { setFullAnalysisBusy } from '@/lib/ai-busy-lock';
import {
  canRunFullAnalysis,
  getAiQuotaStatus,
  isTrialActive,
} from '@/lib/subscription';
import { canUseCloudFeatures, AI_AUTH_REQUIRED_MESSAGE } from '@/lib/supabase/auth-guard';
import { FREE_LIMITS } from '@/types/subscription';
import type { FullProductAnalysis } from '@/types/full-analysis';
import {
  FAKE_RISK_LABELS,
  VERDICT_HEADLINES,
  type FakeRiskLevel,
  type PurchaseVerdict,
} from '@/types/review-analysis';
import type { Product } from '@/types/product';
import {
  AlertTriangle,
  Brain,
  CheckCircle2,
  ChevronDown,
  Clock,
  Crown,
  LogIn,
  Loader2,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  XCircle,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { SubscriptionModal } from '@/popup/components/SubscriptionModal';

const verdictStyles: Record<
  PurchaseVerdict,
  { Icon: typeof CheckCircle2; tone: string; bg: string }
> = {
  buy_now: {
    Icon: CheckCircle2,
    tone: 'text-success',
    bg: 'bg-success/10',
  },
  wait_discount: {
    Icon: Clock,
    tone: 'text-warning',
    bg: 'bg-warning/10',
  },
  not_recommended: {
    Icon: XCircle,
    tone: 'text-destructive',
    bg: 'bg-destructive/10',
  },
};

const fakeRiskStyles: Record<
  FakeRiskLevel,
  { Icon: typeof ShieldCheck; color: string; bar: string; label: string }
> = {
  low: {
    Icon: ShieldCheck,
    color: 'text-success',
    bar: 'w-1/4 bg-success',
    label: 'Низкий',
  },
  medium: {
    Icon: AlertTriangle,
    color: 'text-warning',
    bar: 'w-2/3 bg-warning',
    label: 'Средний',
  },
  high: {
    Icon: ShieldAlert,
    color: 'text-destructive',
    bar: 'w-full bg-destructive',
    label: 'Высокий',
  },
};

function AnalysisBlock({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon?: typeof Sparkles;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-1.5">
        {Icon ? <Icon className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.75} /> : null}
        <SectionLabel>{title}</SectionLabel>
      </div>
      {children}
    </section>
  );
}

interface FullAnalysisSectionProps {
  product: Product;
  isPremium: boolean;
  onOpenPremium: () => void;
  onOpenAuth?: () => void;
  onOpenSettings?: () => void;
  onBusyChange?: (busy: boolean) => void;
}

export function FullAnalysisSection({
  product,
  isPremium: isPremiumProp,
  onOpenPremium,
  onOpenAuth,
  onBusyChange,
}: FullAnalysisSectionProps) {
  const [analysis, setAnalysis] = useState<FullProductAnalysis | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cacheLoaded, setCacheLoaded] = useState(false);
  const [fromCache, setFromCache] = useState(false);
  const [cacheNote, setCacheNote] = useState<string | null>(null);
  const [quotaLabel, setQuotaLabel] = useState('');
  const [trialActive, setTrialActive] = useState(false);
  const [showSubscribe, setShowSubscribe] = useState(false);
  const [subscribeReason, setSubscribeReason] = useState<string | undefined>();
  const [showDetails, setShowDetails] = useState(false);

  const refreshQuota = async () => {
    const [quota, trial] = await Promise.all([getAiQuotaStatus(), isTrialActive()]);
    setQuotaLabel(quota.label);
    setTrialActive(trial);
  };

  useEffect(() => {
    void canUseCloudFeatures().then(setIsAuthenticated);
  }, []);

  useEffect(() => {
    setAnalysis(null);
    setCacheLoaded(false);
    setFromCache(false);
    setCacheNote(null);
    setShowDetails(false);
    void refreshQuota();
    if (!product.url) return;

    void getCachedFullAnalysis({
      url: product.url,
      marketplace: product.marketplace,
      article: product.article,
      id: product.id,
    }).then((cached) => {
      if (cached) {
        setAnalysis(cached.result);
        setFromCache(true);
      }
      setCacheLoaded(true);
    });
  }, [product.id, product.url, product.marketplace, product.article]);

  const handleRun = async (mode: 'run' | 'soft' | 'hard' = 'run') => {
    if (!(await canUseCloudFeatures())) {
      setError(AI_AUTH_REQUIRED_MESSAGE);
      onOpenAuth?.();
      return;
    }

    const allowed = await canRunFullAnalysis();
    if (!allowed.allowed) {
      if (allowed.reason?.includes('Аккаунт')) {
        setError(allowed.reason);
        onOpenAuth?.();
        return;
      }
      setSubscribeReason(allowed.reason);
      setShowSubscribe(true);
      return;
    }

    setIsLoading(true);
    onBusyChange?.(true);
    await setFullAnalysisBusy(true);
    setError(null);
    setFromCache(false);
    setCacheNote(null);
    if (mode === 'hard') setAnalysis(null);

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'FULL_PRODUCT_ANALYSIS',
        payload: {
          productTitle: product.title,
          productPrice: product.price,
          oldPrice: product.oldPrice,
          marketplace: product.marketplace,
          article: product.article,
          productId: product.id,
          productUrl: product.url,
          softRefresh: mode === 'soft',
          forceRefresh: mode === 'hard',
          forceHardRefresh: mode === 'hard',
        },
      });

      if (response?.ok) {
        setAnalysis(response.analysis as FullProductAnalysis);
        setFromCache(Boolean(response.fromCache));
        setCacheNote((response.cacheNote as string) ?? null);
        await refreshQuota();
      } else {
        const err = response?.error ?? 'Не удалось выполнить анализ';
        if (err.includes('Premium') || err.includes('Лимит')) {
          setSubscribeReason(err);
          setShowSubscribe(true);
        } else {
          setError(err);
        }
      }
    } catch {
      setError('Ошибка связи с расширением');
    } finally {
      setIsLoading(false);
      onBusyChange?.(false);
      await setFullAnalysisBusy(false);
    }
  };

  const verdict = analysis ? verdictStyles[analysis.verdict] : null;
  const fakeRisk = analysis ? fakeRiskStyles[analysis.fakeRisk] : null;

  return (
    <>
      <Surface variant="raised" padding="md" className="space-y-4 ring-1 ring-purple/15">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-sm bg-purple/10">
              <Brain className="h-5 w-5 text-purple" strokeWidth={1.75} />
            </div>
            <div className="min-w-0">
              <p className="pg-title">AI-анализ товара</p>
              <p className="pg-hint mt-0.5">
                Free: {FREE_LIMITS.maxAiRequestsPerDay}/день · Premium: приоритетный пайплайн
              </p>
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            {isPremiumProp && <Crown className="h-4 w-4 text-purple" strokeWidth={1.75} />}
            {trialActive && <Badge variant="purple">Пробный период</Badge>}
            {fromCache && analysis && <Badge variant="outline">Из кэша</Badge>}
          </div>
        </div>

        {!isAuthenticated && (
          <Surface variant="subtle" padding="sm" className="space-y-2">
            <p className="pg-body">{AI_AUTH_REQUIRED_MESSAGE}</p>
            <Button size="sm" onClick={() => onOpenAuth?.()}>
              <LogIn className="h-3.5 w-3.5" strokeWidth={1.75} />
              Войти
            </Button>
          </Surface>
        )}

        {quotaLabel && isAuthenticated && (
          <p className="pg-caption text-center">
            AI-анализы: <span className="font-medium text-foreground">{quotaLabel}</span>
          </p>
        )}

        <div className="flex gap-2">
          <Button
            size="lg"
            variant="purple"
            className="min-w-0 flex-1"
            onClick={() => void handleRun('run')}
            disabled={isLoading || !isAuthenticated}
          >
            {isLoading ? (
              <>
                <Loader2 className="h-[18px] w-[18px] animate-spin" />
                Анализируем…
              </>
            ) : (
              <>
                <Sparkles className="h-[18px] w-[18px]" strokeWidth={1.75} />
                Запустить AI-анализ
              </>
            )}
          </Button>
          {analysis && (
            <>
              <Button
                variant="outline"
                size="lg"
                className="shrink-0 px-3"
                onClick={() => void handleRun('soft')}
                disabled={isLoading}
                title="Мягкое обновление: цена без повторного AI"
              >
                <RefreshCw className="h-4 w-4" strokeWidth={1.75} />
              </Button>
              <Button
                variant="ghost"
                size="lg"
                className="shrink-0 px-2 text-muted-foreground"
                onClick={() => void handleRun('hard')}
                disabled={isLoading}
                title="Жёсткое обновление: AI + веб-исследование заново"
              >
                <Clock className="h-4 w-4" strokeWidth={1.75} />
              </Button>
            </>
          )}
        </div>

        {!isPremiumProp && cacheLoaded && !analysis && !isLoading && isAuthenticated && (
          <p className="pg-caption text-center">
            Осталось: {quotaLabel}.{' '}
            <button
              type="button"
              className="font-medium text-purple underline-offset-2 hover:underline"
              onClick={() => setShowSubscribe(true)}
            >
              Узнать про Premium
            </button>
          </p>
        )}

        {error && (
          <Surface variant="subtle" padding="sm" className="bg-destructive/10">
            <p className="pg-hint text-destructive">{error}</p>
          </Surface>
        )}

        {cacheNote && (
          <Surface variant="subtle" padding="sm" className="bg-warning/10">
            <p className="pg-hint text-warning">{cacheNote}</p>
          </Surface>
        )}

        {analysis && verdict && fakeRisk && (
          <div className="space-y-5 border-t border-border/60 pt-4">
            <div className="flex items-center gap-4">
              <ScoreRing score={analysis.qualityScore} />
              <div className="min-w-0 flex-1 space-y-2">
                <Badge variant="outline">{analysis.providerLabel}</Badge>
                <p className="pg-body text-muted-foreground">
                  {analysis.qualitySummary || analysis.webOverview}
                </p>
              </div>
            </div>

            {(analysis.pros.length > 0 || analysis.cons.length > 0) && (
              <div className="grid grid-cols-2 gap-3">
                {analysis.pros.length > 0 && (
                  <AnalysisBlock title="Плюсы" icon={ThumbsUp}>
                    <ul className="space-y-1.5">
                      {analysis.pros.slice(0, 4).map((p) => (
                        <li key={p} className="pg-hint flex gap-1.5 text-foreground">
                          <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-success" />
                          <span className="min-w-0">{p}</span>
                        </li>
                      ))}
                    </ul>
                  </AnalysisBlock>
                )}
                {analysis.cons.length > 0 && (
                  <AnalysisBlock title="Минусы" icon={ThumbsDown}>
                    <ul className="space-y-1.5">
                      {analysis.cons.slice(0, 4).map((c) => (
                        <li key={c} className="pg-hint flex gap-1.5 text-foreground">
                          <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-destructive" />
                          <span className="min-w-0">{c}</span>
                        </li>
                      ))}
                    </ul>
                  </AnalysisBlock>
                )}
              </div>
            )}

            <Surface variant="subtle" padding="sm" className={verdict.bg}>
              <div className="flex items-start gap-2">
                <verdict.Icon className={`mt-0.5 h-4 w-4 shrink-0 ${verdict.tone}`} strokeWidth={1.75} />
                <div className="min-w-0">
                  <p className={`pg-subtitle ${verdict.tone}`}>
                    {VERDICT_HEADLINES[analysis.verdict]}
                  </p>
                  <p className="pg-hint mt-1 text-foreground/80">{analysis.verdictExplanation}</p>
                </div>
              </div>
            </Surface>

            {analysis.alternatives.length > 0 && (
              <AnalysisBlock title="Альтернативы">
                <div className="space-y-2">
                  {analysis.alternatives.map((alt) => (
                    <div key={`${alt.name}-${alt.reason}`} className="rounded-sm bg-muted/50 px-3 py-2">
                      <p className="pg-subtitle">{alt.name}</p>
                      <p className="pg-hint mt-0.5">{alt.reason}</p>
                    </div>
                  ))}
                </div>
              </AnalysisBlock>
            )}

            {analysis.priceInsight && (
              <AnalysisBlock title="Цена">
                <p className="pg-body">{analysis.priceInsight}</p>
              </AnalysisBlock>
            )}

            <button
              type="button"
              className="flex w-full items-center justify-center gap-1 py-1 pg-caption hover:text-foreground"
              onClick={() => setShowDetails((v) => !v)}
            >
              Подробнее
              <ChevronDown
                className={`h-3.5 w-3.5 pg-transition ${showDetails ? 'rotate-180' : ''}`}
              />
            </button>

            {showDetails && (
              <div className="space-y-4">
                {analysis.keySpecs?.length > 0 && (
                  <AnalysisBlock title="Характеристики">
                    <ul className="space-y-1">
                      {analysis.keySpecs.map((s) => (
                        <li key={s} className="pg-hint">
                          · {s}
                        </li>
                      ))}
                    </ul>
                  </AnalysisBlock>
                )}

                {analysis.hiddenProblems?.length > 0 && (
                  <AnalysisBlock title="Скрытые проблемы">
                    <ul className="space-y-1">
                      {analysis.hiddenProblems.map((s) => (
                        <li key={s} className="pg-hint text-warning">
                          · {s}
                        </li>
                      ))}
                    </ul>
                  </AnalysisBlock>
                )}

                <AnalysisBlock title="Риск подделки">
                  <div className="mb-2 flex items-center gap-2">
                    <fakeRisk.Icon className={`h-4 w-4 ${fakeRisk.color}`} strokeWidth={1.75} />
                    <span className={`pg-subtitle ${fakeRisk.color}`}>
                      {FAKE_RISK_LABELS[analysis.fakeRisk]} — {fakeRisk.label}
                    </span>
                  </div>
                  <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className={`h-full rounded-full pg-transition ${fakeRisk.bar}`} />
                  </div>
                  <p className="pg-hint">{analysis.fakeRiskExplanation}</p>
                </AnalysisBlock>

                {analysis.webOverview &&
                  analysis.webOverview !== analysis.qualitySummary && (
                    <AnalysisBlock title="Обзор">
                      <p className="pg-body">{analysis.webOverview}</p>
                    </AnalysisBlock>
                  )}

                {analysis.webSources && analysis.webSources.length > 0 && (
                  <AnalysisBlock title="Источники">
                    <ul className="space-y-1">
                      {analysis.webSources.map((source) => (
                        <li key={source.url}>
                          <a
                            href={source.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="pg-hint text-primary underline-offset-2 hover:underline"
                          >
                            {source.title}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </AnalysisBlock>
                )}
              </div>
            )}
          </div>
        )}
      </Surface>

      <SubscriptionModal
        open={showSubscribe}
        onClose={() => setShowSubscribe(false)}
        onSubscribed={() => {
          void refreshQuota();
          onOpenPremium();
        }}
        onOpenAuth={onOpenAuth}
        reason={subscribeReason}
      />
    </>
  );
}
