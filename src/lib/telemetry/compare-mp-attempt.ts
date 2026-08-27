/**
 * Privacy-safe compare path telemetry (no URL/title).
 * path: cache | api | tab | scrappey | skip
 */
import { telemetry } from '@/lib/telemetry/log';

export type CompareMpAttemptPath = 'cache' | 'api' | 'tab' | 'scrappey' | 'skip';

export function trackCompareMpAttempt(input: {
  marketplace: string;
  path: CompareMpAttemptPath;
  success: boolean;
  /** Skip / fail reason code only — no PII */
  reason?: string;
  productId?: string;
}): void {
  telemetry.info({
    stage: 'search',
    name: 'COMPARE_MP_ATTEMPT',
    marketplace: input.marketplace,
    productId: input.productId,
    success: input.success,
    data: {
      path: input.path,
      ...(input.reason ? { reason: input.reason.slice(0, 80) } : {}),
    },
  });
}
