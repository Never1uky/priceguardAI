import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScoreRing } from '@/components/ui/score-ring';
import { SectionLabel } from '@/components/ui/section-label';
import { Surface } from '@/components/ui/surface';
import {
  buildStarDistribution,
  getAnalysisFeedback,
  setAnalysisFeedback,
  type AnalysisFeedbackVote,
} from '@/lib/analysis-feedback';
import { getCachedFullAnalysis } from '@/lib/full-analysis-cache';
import { setFullAnalysisBusy } from '@/lib/ai-busy-lock';
import {
  getFullAnalysisJobSnapshot,
  jobMatchesProduct,
} from '@/lib/ai/full-analysis-job';
import { fullAnalysisCacheBadgeLabel } from '@/lib/ai/full-analysis-quota-policy';
import {
  canRunFullAnalysis,
  getAiQuotaStatus,
  isTrialActive,
} from '@/lib/subscription';
import { canUseCloudFeatures, AI_AUTH_REQUIRED_MESSAGE } from '@/lib/supabase/auth-guard';
import { sendRuntimeMessage } from '@/lib/runtime-message';
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
  Info,
  LogIn,
  Loader2,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Star,
  ThumbsDown,
  ThumbsUp,
  XCircle,
} from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { SubscriptionModal } from '@/popup/components/SubscriptionModal';

const verdictStyles: Record<
  PurchaseVerdict,
  { Icon: typeof CheckCircle2; tone: string; bg: string; short: string }
> = {
  buy_now: {
    Icon: CheckCircle2,
    tone: 'text-success',
    bg: 'bg-success/10',
    short: 'Покупать',
  },
  wait_discount: {
    Icon: Clock,
    tone: 'text-warning',
    bg: 'bg-warning/10',
    short: 'Подождать',
  },
  not_recommended: {
    Icon: XCircle,
    tone: 'text-destructive',
    bg: 'bg-destructive/10',
    short: 'Не покупать',
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

function StarDistributionBars({ counts }: { counts: number[] }) {
  const total = counts.reduce((a, b) => a + b, 0) || 1;
  return (
    <div className="space-y-1.5">
      {[5, 4, 3, 2, 1].map((star) => {
        const count = counts[star - 1] ?? 0;
        const pct = Math.round((count / total) * 100);
        const barTone =
          star >= 4 ? 'bg-success' : star === 3 ? 'bg-warning' : 'bg-destructive';
        return (
          <div key={star} className="flex items-center gap-2">
            <span className="w-3 shrink-0 text-right pg-caption tabular-nums">{star}</span>
            <Star className="h-3 w-3 shrink-0 text-warning" fill="currentColor" aria-hidden />
            <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full rounded-full pg-transition ${barTone}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="w-8 shrink-0 text-right pg-caption tabular-nums">{pct}%</span>
          </div>
        );
      })}
    </div>
  );
}

interface FullAnalysisSectionProps {
  product: Product;
  isPremium: boolean;
  reviewRatings?: Array<number | undefined>;
  onOpenPremium: () => void;
  onOpenAuth?: () => void;
  onOpenSettings?: () => void;
  onBusyChange?: (busy: boolean) => void;
}

export function FullAnalysisSection({
  product,
  isPremium: isPremiumProp,
  reviewRatings,
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
  const [cacheReason, setCacheReason] = useState<string | null>(null);
  const [quotaConsumedOnShow, setQuotaConsumedOnShow] = useState(false);
  const [cacheNote, setCacheNote] = useState<string | null>(null);
  const [quotaLabel, setQuotaLabel] = useState('');
  const [trialActive, setTrialActive] = useState(false);
  const [showSubscribe, setShowSubscribe] = useState(false);
  const [subscribeReason, setSubscribeReason] = useState<string | undefined>();
  const [showDetails, setShowDetails] = useState(false);
  const [feedbackVote, setFeedbackVote] = useState<AnalysisFeedbackVote | null>(null);
  const [feedbackThanks, setFeedbackThanks] = useState(false);

  const starCounts = useMemo(() => buildStarDistribution(reviewRatings), [reviewRatings]);
  const ratingSum = useMemo(() => {
    if (!starCounts) return null;
    const total = starCounts.reduce((a, b) => a + b, 0);
    if (!total) return null;
    const weighted = starCounts.reduce((sum, count, i) => sum + count * (i + 1), 0);
    return { avg: weighted / total, total };
  }, [starCounts]);

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
    setCacheReason(null);
    setQuotaConsumedOnShow(false);
    setCacheNote(null);
    setShowDetails(false);
    setFeedbackVote(null);
    setFeedbackThanks(false);
    void refreshQuota();
    if (!product.url) return;

    let cancelled = false;

    const hydrate = async () => {
      const job = await getFullAnalysisJobSnapshot();
      if (!cancelled && job && jobMatchesProduct(job, product)) {
        if (job.status === 'running') {
          setIsLoading(true);
          onBusyChange?.(true);
          for (let i = 0; i < 60 && !cancelled; i++) {
            await new Promise((r) => setTimeout(r, 500));
            const next = await getFullAnalysisJobSnapshot();
            if (!next || !jobMatchesProduct(next, product)) break;
            if (next.status === 'done' && next.analysis) {
              setAnalysis(next.analysis);
              setFromCache(Boolean(next.fromCache));
              setCacheReason(next.cacheReason ?? null);
              setQuotaConsumedOnShow(Boolean(next.quotaConsumed && next.fromCache));
              setCacheNote(next.cacheNote ?? null);
              setIsLoading(false);
              onBusyChange?.(false);
              await refreshQuota();
              setCacheLoaded(true);
              return;
            }
            if (next.status === 'error') {
              setError(next.error ?? 'Не удалось выполнить анализ');
              setIsLoading(false);
              onBusyChange?.(false);
              await refreshQuota();
              setCacheLoaded(true);
              return;
            }
          }
          setIsLoading(false);
          onBusyChange?.(false);
        } else if (job.status === 'done' && job.analysis) {
          const fresh = job.finishedAt && Date.now() - job.finishedAt < 15 * 60 * 1000;
          if (fresh && job.intent !== 'soft_refresh') {
            setAnalysis(job.analysis);
            setFromCache(Boolean(job.fromCache));
            setCacheReason(job.cacheReason ?? null);
            setQuotaConsumedOnShow(Boolean(job.quotaConsumed && job.fromCache));
            setCacheNote(job.cacheNote ?? null);
            await refreshQuota();
            setCacheLoaded(true);
            return;
          }
        }
      }

      const cached = await getCachedFullAnalysis({
        url: product.url,
        marketplace: product.marketplace,
        article: product.article,
        id: product.id,
      });
      if (cancelled) return;
      if (cached) {
        setAnalysis(cached.result);
        setFromCache(true);
        setCacheReason('LOCAL_CACHE');
        setQuotaConsumedOnShow(false);
      }
      setCacheLoaded(true);
      await refreshQuota();
    };

    void hydrate();
    return () => {
      cancelled = true;
    };
  }, [product.id, product.url, product.marketplace, product.article]);

  useEffect(() => {
    if (!analysis) {
      setFeedbackVote(null);
      return;
    }
    void getAnalysisFeedback(product.id, analysis.analyzedAt).then(setFeedbackVote);
  }, [product.id, analysis?.analyzedAt]);

  const handleFeedback = async (vote: AnalysisFeedbackVote) => {
    if (!analysis || feedbackVote) return;
    await setAnalysisFeedback(product.id, analysis.analyzedAt, vote);
    setFeedbackVote(vote);
    setFeedbackThanks(true);
  };

  const handleRun = async (
    mode: 'run' | 'soft' | 'hard' = 'run',
    opts: { webResearch?: boolean } = {},
  ) => {
    if (!(await canUseCloudFeatures())) {
      setError(AI_AUTH_REQUIRED_MESSAGE);
      onOpenAuth?.();
      return;
    }

    const wantDeep = Boolean(opts.webResearch);

    if (wantDeep && !isPremiumProp && !trialActive) {
      setSubscribeReason('Глубокий разбор (AI + веб) доступен в Premium');
      setShowSubscribe(true);
      return;
    }

    // Soft = только overlay цены, квоту не тратит и не требует remaining
    if (mode !== 'soft') {
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
    }

    setIsLoading(true);
    onBusyChange?.(true);
    await setFullAnalysisBusy(true);
    setError(null);
    setFromCache(false);
    setCacheReason(null);
    setQuotaConsumedOnShow(false);
    setCacheNote(null);
    setFeedbackThanks(false);
    if (mode === 'hard' || wantDeep) setAnalysis(null);

    try {
      const response = await sendRuntimeMessage<{
        ok?: boolean;
        analysis?: FullProductAnalysis;
        fromCache?: boolean;
        cacheNote?: string;
        cacheReason?: string;
        cacheConfidence?: number;
        quotaConsumed?: boolean;
        error?: string;
      }>({
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
          // Deep: пересчитать анализ (не отдавать lite-кэш); Sonar сбрасывается только hard
          forceRefresh: mode === 'hard' || wantDeep,
          forceHardRefresh: mode === 'hard' && wantDeep,
          webResearch: wantDeep,
        },
      });

      if (response?.ok && response.analysis) {
        setAnalysis(response.analysis);
        setFromCache(Boolean(response.fromCache));
        setCacheReason(response.cacheReason ?? null);
        setQuotaConsumedOnShow(Boolean(response.quotaConsumed && response.fromCache));
        setCacheNote(response.cacheNote ?? null);
        await refreshQuota();
      } else {
        const err = response?.error ?? 'Не удалось выполнить анализ';
        if (err.includes('Premium') || err.includes('Лимит') || err.includes('глубокого')) {
          setSubscribeReason(err);
          setShowSubscribe(true);
        } else {
          setError(err);
        }
        await refreshQuota();
      }
    } catch {
      setError('Ошибка связи с расширением');
      // Mid-run close → reopen подхватит job; здесь просто sync quota
      await refreshQuota();
    } finally {
      setIsLoading(false);
      onBusyChange?.(false);
      await setFullAnalysisBusy(false);
    }
  };

  const cacheBadge = fullAnalysisCacheBadgeLabel({
    fromCache,
    quotaConsumed: quotaConsumedOnShow,
    cacheReason,
  });

  const verdict = analysis ? verdictStyles[analysis.verdict] : null;
  const fakeRisk = analysis ? fakeRiskStyles[analysis.fakeRisk] : null;
  const score100 = analysis
    ? Math.min(100, Math.max(0, Math.round(analysis.qualityScore * 10)))
    : 0;

  return (
    <>
      <Surface variant="raised" padding="md" className="space-y-4 ring-1 ring-primary/15">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-sm bg-primary/10">
              <Brain className="h-5 w-5 text-primary" strokeWidth={1.75} />
            </div>
            <div className="min-w-0">
              <p className="pg-title">AI-анализ товара</p>
              <p className="pg-hint mt-0.5">
                Free: {FREE_LIMITS.maxAiRequestsPerDay}/день · Premium: без лимита + глубокий разбор
              </p>
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            {isPremiumProp && <Crown className="h-4 w-4 text-purple" strokeWidth={1.75} />}
            {trialActive && <Badge variant="purple">Пробный период</Badge>}
            {fromCache && analysis && cacheBadge && (
              <Badge variant="outline">{cacheBadge}</Badge>
            )}
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
          <p className="pg-caption text-center font-medium text-foreground">{quotaLabel}</p>
        )}

        <div className="space-y-2">
          <div className="flex gap-2">
            <Button
              size="lg"
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
                  className="shrink-0 gap-1 px-2.5 text-[11px]"
                  onClick={() => void handleRun('soft')}
                  disabled={isLoading}
                  title="Обновить цену без повторного AI"
                  aria-label="Обновить цену"
                >
                  <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.75} />
                  Цена
                </Button>
                <Button
                  variant="ghost"
                  size="lg"
                  className="shrink-0 gap-1 px-2 text-[11px] text-muted-foreground"
                  onClick={() => void handleRun('hard')}
                  disabled={isLoading}
                  title="Пересчитать AI без веб-исследования"
                  aria-label="Пересчитать AI"
                >
                  <Clock className="h-3.5 w-3.5" strokeWidth={1.75} />
                  AI
                </Button>
              </>
            )}
          </div>

          {isAuthenticated && (
            <div className="space-y-1">
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => {
                  if (!isPremiumProp && !trialActive) {
                    setSubscribeReason('Глубокий разбор (AI + веб) доступен в Premium');
                    setShowSubscribe(true);
                    return;
                  }
                  void handleRun('run', { webResearch: true });
                }}
                disabled={isLoading}
                title="Sonar → GPT · дороже · актуальный веб-контекст"
              >
                <Crown className="h-3.5 w-3.5" strokeWidth={1.75} />
                Глубокий разбор
              </Button>
              <p className="pg-caption text-center text-muted-foreground">
                AI + веб · дороже · актуальный контекст
              </p>
            </div>
          )}
        </div>

        {!isPremiumProp && cacheLoaded && !analysis && !isLoading && isAuthenticated && (
          <p className="pg-caption text-center">
            <button
              type="button"
              className="font-medium text-primary underline-offset-2 hover:underline"
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

        {cacheNote &&
          !/product-intel|из кэша|AI Cache|общего AI/i.test(cacheNote) && (
          <Surface variant="subtle" padding="sm" className="bg-warning/10">
            <p className="pg-hint text-warning">{cacheNote}</p>
          </Surface>
        )}

        {analysis && verdict && fakeRisk && (
          <div className="space-y-5 border-t border-border/60 pt-4">
            <div className="flex items-start gap-4">
              <div className="min-w-0 flex-1 space-y-2">
                <p className="pg-caption">Вердикт AI</p>
                <p className={`text-[20px] font-semibold leading-none ${verdict.tone}`}>
                  {verdict.short}
                </p>
                <p className="pg-body text-muted-foreground">
                  {analysis.qualitySummary || analysis.verdictExplanation}
                </p>
                <p className="pg-caption text-muted-foreground/80">
                  Автоматический разбор отзывов и данных — не персональная рекомендация к покупке.
                </p>
                <Badge variant="outline">{analysis.providerLabel}</Badge>
              </div>
              <ScoreRing
                score={score100}
                max={100}
                label={
                  score100 >= 80
                    ? 'Отлично'
                    : score100 >= 60
                      ? 'Хорошо'
                      : score100 >= 40
                        ? 'Средне'
                        : 'Слабо'
                }
              />
            </div>

            {(analysis.pros.length > 0 || analysis.cons.length > 0) && (
              <div className="grid grid-cols-2 gap-3">
                {analysis.pros.length > 0 && (
                  <AnalysisBlock title="Плюсы" icon={ThumbsUp}>
                    <ul className="space-y-1.5">
                      {analysis.pros.slice(0, 5).map((p) => (
                        <li key={p} className="pg-hint flex gap-1.5 text-foreground">
                          <CheckCircle2
                            className="mt-0.5 h-3 w-3 shrink-0 text-success"
                            strokeWidth={1.75}
                          />
                          <span className="min-w-0">{p}</span>
                        </li>
                      ))}
                    </ul>
                  </AnalysisBlock>
                )}
                {analysis.cons.length > 0 && (
                  <AnalysisBlock title="Минусы" icon={ThumbsDown}>
                    <ul className="space-y-1.5">
                      {analysis.cons.slice(0, 5).map((c) => (
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

            {starCounts && ratingSum && (
              <Surface variant="subtle" padding="sm" className="space-y-3">
                <div className="flex items-center gap-1.5">
                  <SectionLabel>Сводка отзывов</SectionLabel>
                  <Info className="h-3 w-3 text-muted-foreground" aria-hidden />
                </div>
                <div className="flex items-start gap-4">
                  <div className="shrink-0 space-y-1">
                    <div className="flex items-center gap-0.5">
                      {[1, 2, 3, 4, 5].map((s) => (
                        <Star
                          key={s}
                          className={`h-3.5 w-3.5 ${
                            s <= Math.round(ratingSum.avg)
                              ? 'text-success'
                              : 'text-muted-foreground/40'
                          }`}
                          fill={s <= Math.round(ratingSum.avg) ? 'currentColor' : 'none'}
                          aria-hidden
                        />
                      ))}
                    </div>
                    <p className="text-[15px] font-semibold tabular-nums">
                      {ratingSum.avg.toFixed(1)}
                    </p>
                    <p className="pg-caption">На основе {ratingSum.total} отзывов</p>
                  </div>
                  <div className="min-w-0 flex-1">
                    <StarDistributionBars counts={starCounts} />
                  </div>
                </div>
              </Surface>
            )}

            <Surface variant="subtle" padding="sm" className={verdict.bg}>
              <div className="flex items-start gap-2">
                <verdict.Icon
                  className={`mt-0.5 h-4 w-4 shrink-0 ${verdict.tone}`}
                  strokeWidth={1.75}
                />
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
                    <div
                      key={`${alt.name}-${alt.reason}`}
                      className="rounded-sm bg-muted/50 px-3 py-2"
                    >
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

                {analysis.webOverview && analysis.webOverview !== analysis.qualitySummary && (
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

            <div className="flex items-center justify-between gap-2 border-t border-border/60 pt-3">
              <p className="pg-caption">
                Анализ выполнен AI
                {fromCache ? '' : ' · обновлено только что'}
              </p>
              <div className="flex items-center gap-1">
                {feedbackThanks || feedbackVote ? (
                  <span className="pg-caption text-success">Спасибо</span>
                ) : (
                  <>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label="Анализ полезен"
                      onClick={() => void handleFeedback('up')}
                    >
                      <ThumbsUp className="h-3.5 w-3.5" strokeWidth={1.75} />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label="Анализ не полезен"
                      onClick={() => void handleFeedback('down')}
                    >
                      <ThumbsDown className="h-3.5 w-3.5" strokeWidth={1.75} />
                    </Button>
                  </>
                )}
              </div>
            </div>
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
