import { useCallback, useEffect, useState } from 'react';
import {
  fetchMetricsDashboard,
  type EconomicsDashboardBlock,
  type MetricsDashboardData,
} from '@/lib/supabase/metrics-dashboard';
import { getAuthUser } from '@/lib/supabase/auth';
import { isDeveloperEmail } from '@/lib/developer-access';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { AlertTriangle, BarChart3, Loader2, RefreshCw } from 'lucide-react';

function MetricTable({
  title,
  rows,
  columns,
}: {
  title: string;
  rows: Record<string, unknown>[];
  columns: { key: string; label: string }[];
}) {
  if (!rows.length) {
    return (
      <Card className="shadow-none">
        <CardContent className="p-3">
          <p className="mb-1 text-xs font-semibold">{title}</p>
          <p className="text-[10px] text-muted-foreground">Нет данных</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="shadow-none">
      <CardContent className="overflow-x-auto p-3">
        <p className="mb-2 text-xs font-semibold">{title}</p>
        <table className="w-full text-[10px]">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              {columns.map((c) => (
                <th key={c.key} className="px-1 py-1 font-medium">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 30).map((row, i) => (
              <tr key={i} className="border-b border-muted/40">
                {columns.map((c) => (
                  <td key={c.key} className="px-1 py-1">
                    {String(row[c.key] ?? '—')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

function Kpi({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className="rounded-sm border border-border/60 bg-background px-2.5 py-2">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-base font-semibold tabular-nums text-foreground">{value}</p>
      {hint ? <p className="mt-0.5 text-[9px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function EconomicsSection({ eco }: { eco: EconomicsDashboardBlock }) {
  return (
    <Card className="shadow-none">
      <CardContent className="space-y-3 p-3">
        <div>
          <p className="text-xs font-semibold">Economics — monitoring (Phase 12)</p>
          <p className="text-[10px] text-muted-foreground">
            Период {eco.periodDays}д · Scrappey {eco.assumptions?.scrappeyRubPerThousandCalls ?? 4} ₽ /
            1000 calls · dedup KPI
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Kpi label="Active monitored products" value={eco.activeMonitoredProducts} />
          <Kpi label="Unique monitoring targets" value={eco.uniqueMonitoringTargets} />
          <Kpi
            label="Avg subscribers / target"
            value={eco.avgSubscribersPerTarget}
            hint={`max ${eco.maxSubscribersPerTarget} · users ${eco.monitoringUsers}`}
          />
          <Kpi label="Checks / day" value={eco.checksPerDay} />
          <Kpi label="Scrape requests / day" value={eco.scrapeRequestsPerDay} />
          <Kpi label="Cache hit rate" value={`${eco.cacheHitRatePct}%`} />
          <Kpi
            label="Scrape failures"
            value={eco.scrapeFailures}
            hint={`${eco.scrapeFailuresPerDay}/day`}
          />
          <Kpi
            label="Scrapes / active product"
            value={eco.scrapeRequestsPerActiveMonitoredProduct}
            hint="ниже при sharing"
          />
          <Kpi
            label="Scrapes / unique target"
            value={eco.scrapeRequestsPerUniqueTarget}
            hint={`dedup ×${eco.dedupFactor}`}
          />
          <Kpi
            label="Cost / day (₽)"
            value={`${eco.costEstimateRubPerDay.optimistic}–${eco.costEstimateRubPerDay.pessimistic}`}
            hint="opt–pess"
          />
          <Kpi
            label="Cost / month (₽)"
            value={`${eco.costEstimateRubPerMonth.optimistic}–${eco.costEstimateRubPerMonth.pessimistic}`}
            hint="×30 from daily"
          />
          <Kpi
            label="Scrapes saved (est.)"
            value={eco.estimatedScrapesSaved}
            hint="vs 1 scrape × subscriber × check"
          />
        </div>
      </CardContent>
    </Card>
  );
}

export function MetricsDashboard() {
  const [data, setData] = useState<MetricsDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [periodDays, setPeriodDays] = useState<1 | 7 | 30>(30);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const user = await getAuthUser();
      setEmail(user?.email ?? null);
      if (!user) {
        setError('Войдите в аккаунт для просмотра метрик');
        setData(null);
        return;
      }
      if (!isDeveloperEmail(user.email)) {
        setError('Доступ только для разработчика');
        setData(null);
        return;
      }
      const result = await fetchMetricsDashboard(periodDays);
      if (!result.ok) {
        setError(result.error ?? 'Не удалось загрузить метрики');
        return;
      }
      setData(result);
      const alerting = result.alerts?.alertingMarketplaces ?? [];
      if (result.alerts?.lowSearchSuccessRate || result.alerts?.wbLowSuccessRate) {
        console.warn(
          `[PriceGuard Metrics] Search success rate alert: ${alerting.join(',') || 'wildberries'} < ${result.alerts.thresholdPct}%`,
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }, [periodDays]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="min-h-screen bg-slate-50 p-4 dark:bg-slate-950">
      <div className="mx-auto max-w-4xl space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-indigo-600" />
            <div>
              <h1 className="text-lg font-bold">PriceGuard — метрики</h1>
              <p className="text-xs text-muted-foreground">{email ?? 'Не авторизован'}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <select
              className="rounded-sm border bg-background px-2 py-1.5 text-xs"
              value={periodDays}
              aria-label="Период"
              onChange={(e) => setPeriodDays(Number(e.target.value) as 1 | 7 | 30)}
            >
              <option value={1}>1 день</option>
              <option value={7}>7 дней</option>
              <option value={30}>30 дней</option>
            </select>
            <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={`mr-1 h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              Обновить
            </Button>
          </div>
        </div>

        {loading && (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        )}

        {error && !loading && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
        )}

        {(data?.alerts?.lowSearchSuccessRate || data?.alerts?.wbLowSuccessRate) && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-medium">Алерт: поиск (24ч)</p>
              <p className="text-xs">
                Low success rate: {(data.alerts.alertingMarketplaces ?? ['wildberries']).join(', ')}{' '}
                (порог {data.alerts.thresholdPct}%, min 5 запросов)
              </p>
            </div>
          </div>
        )}

        {data && !loading && (
          <>
            {data.economics ? <EconomicsSection eco={data.economics} /> : null}

            <MetricTable
              title="Reliability — поиск 24ч"
              rows={(data.searchSuccessRate24h ?? []).map((r) => ({
                marketplace: r.marketplace,
                success_rate_pct: r.successRatePct,
                n: `${r.successfulRequests}/${r.totalRequests}`,
                avg_ms: r.avgResponseTimeMs ?? '—',
                alert: r.alert ? '⚠' : '',
              }))}
              columns={[
                { key: 'marketplace', label: 'МП' },
                { key: 'success_rate_pct', label: 'OK%' },
                { key: 'n', label: 'n' },
                { key: 'avg_ms', label: 'avg ms' },
                { key: 'alert', label: '' },
              ]}
            />

            <MetricTable
              title="Поиск — по дням (30 дней)"
              rows={data.searchDaily as unknown as Record<string, unknown>[]}
              columns={[
                { key: 'day', label: 'День' },
                { key: 'marketplace', label: 'МП' },
                { key: 'total_requests', label: 'Запросы' },
                { key: 'success_rate_pct', label: 'Success %' },
                { key: 'avg_response_time_ms', label: 'Avg ms' },
              ]}
            />

            <MetricTable
              title="Поиск — по неделям (7 дней)"
              rows={data.searchWeekly as unknown as Record<string, unknown>[]}
              columns={[
                { key: 'week_start', label: 'Неделя' },
                { key: 'marketplace', label: 'МП' },
                { key: 'total_requests', label: 'Запросы' },
                { key: 'success_rate_pct', label: 'Success %' },
              ]}
            />

            <MetricTable
              title="AI-запросы"
              rows={data.aiRequests as unknown as Record<string, unknown>[]}
              columns={[
                { key: 'day', label: 'День' },
                { key: 'provider', label: 'Провайдер' },
                { key: 'request_count', label: 'Запросы' },
                { key: 'error_count', label: 'Ошибки' },
                { key: 'avg_total_tokens', label: 'Avg tokens' },
              ]}
            />

            <p className="text-[10px] text-muted-foreground">
              Обновлено: {new Date(data.generatedAt).toLocaleString('ru-RU')}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
