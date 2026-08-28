import { describe, expect, it } from 'vitest';
import {
  evaluateSearchSuccessAlerts,
  formatSearchSuccessAlertTelegramHtml,
  resolveSearchSuccessAlertThreshold,
} from './search-success-alerts.ts';

describe('search-success-alerts', () => {
  it('resolveSearchSuccessAlertThreshold prefers SEARCH_ over WB_', () => {
    expect(
      resolveSearchSuccessAlertThreshold({
        get: (k) =>
          k === 'SEARCH_SUCCESS_RATE_ALERT_THRESHOLD'
            ? '70'
            : k === 'WB_SUCCESS_RATE_ALERT_THRESHOLD'
              ? '85'
              : undefined,
      }),
    ).toBe(70);
    expect(
      resolveSearchSuccessAlertThreshold({
        get: (k) => (k === 'WB_SUCCESS_RATE_ALERT_THRESHOLD' ? '90' : undefined),
      }),
    ).toBe(90);
    expect(resolveSearchSuccessAlertThreshold({ get: () => undefined })).toBe(85);
  });

  it('evaluateSearchSuccessAlerts requires min 5 requests', () => {
    const { alert, alerting, byMarketplace } = evaluateSearchSuccessAlerts(
      [
        {
          marketplace: 'wildberries',
          total_requests: 4,
          successful_requests: 1,
          success_rate_pct: 25,
        },
        {
          marketplace: 'ozon',
          total_requests: 10,
          successful_requests: 5,
          success_rate_pct: 50,
        },
      ],
      85,
    );
    expect(alert).toBe(true);
    expect(alerting.map((a) => a.marketplace)).toEqual(['ozon']);
    expect(byMarketplace.find((r) => r.marketplace === 'wildberries')?.alert).toBe(false);
    expect(byMarketplace.find((r) => r.marketplace === 'aliexpress')?.totalRequests).toBe(0);
  });

  it('formatSearchSuccessAlertTelegramHtml lists all alerting MPs', () => {
    const html = formatSearchSuccessAlertTelegramHtml(
      [
        {
          marketplace: 'ozon',
          successRatePct: 50,
          totalRequests: 10,
          successfulRequests: 5,
          avgResponseTimeMs: null,
          alert: true,
        },
        {
          marketplace: 'megamarket',
          successRatePct: 40,
          totalRequests: 20,
          successfulRequests: 8,
          avgResponseTimeMs: 1000,
          alert: true,
        },
      ],
      85,
    );
    expect(html).toContain('ozon');
    expect(html).toContain('megamarket');
    expect(html).not.toContain('Wildberries');
  });
});
