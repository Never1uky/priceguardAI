/**
 * Privacy-safe product funnel events.
 * Local ring always (bypasses INFO sample). Remote INFO only when remoteEnabled opt-in.
 * Never log URLs, titles, reviews, chat ids, emails, product ids, or payment details.
 */
import { telemetry } from '@/lib/telemetry/log';
import type { Marketplace } from '@/types/product';
import type { PremiumPlanId } from '@/types/subscription';
import { COMPARISON_MARKETPLACE_IDS } from '@/lib/marketplaces/registry';

const FUNNEL_FLAGS_KEY = 'priceguard_funnel_flags_v1';
const CARD_OPEN_DEDUPE_KEY = 'priceguard_funnel_card_open_dedupe_v1';
const SESSION_STARTED_KEY = 'priceguard_funnel_popup_started_v1';
/** Dedupe card opens for 30 minutes per marketplace+article hash */
const CARD_DEDUPE_TTL_MS = 30 * 60 * 1000;

export type FunnelInstallReason = 'install' | 'update' | 'chrome_update' | 'shared_module_update';

export type CompareOutcome = 'success' | 'needs_choice' | 'not_found' | 'error';

export type FunnelFailureReason =
  | 'parser_error'
  | 'network_error'
  | 'marketplace_unavailable'
  | 'product_not_found'
  | 'matching_failed'
  | 'timeout'
  | 'unknown';

export type FunnelDurationBucket = 'lt_1s' | '1_3s' | '3_10s' | '10_30s' | '30s_plus';

export type FunnelResultType = 'exact' | 'candidate' | 'manual' | 'not_found';

export type FunnelAiSource = 'cache' | 'generate';

export const FUNNEL_EVENT_NAMES = [
  'extension_installed',
  'extension_started',
  'product_card_opened',
  'marketplace_page_detected',
  'compare_started',
  'compare_completed',
  'comparison_failed',
  'compare_rejected',
  'compare_candidate_selected',
  'match_completed',
  'match_failed',
  'match_manual_selection',
  'ai_started',
  'ai_analysis_started',
  'ai_analysis_completed',
  'ai_analysis_failed',
  'ai_analysis_cache_hit',
  'product_tracking_added',
  'product_tracking_removed',
  'monitoring_refresh',
  'monitoring_refresh_failed',
  'telegram_linked',
  'telegram_connect_started',
  'telegram_connected',
  'telegram_disconnected',
  'trial_claimed',
  'checkout_started',
  'premium_active',
  'premium_page_opened',
] as const;

export type FunnelEventName = (typeof FUNNEL_EVENT_NAMES)[number];

const FUNNEL_NAME_SET = new Set<string>(FUNNEL_EVENT_NAMES);

export function isFunnelEventName(name: string): boolean {
  return FUNNEL_NAME_SET.has(name);
}

const ALLOWED_MARKETPLACES = new Set<string>(COMPARISON_MARKETPLACE_IDS);

const FUNNEL_DATA_KEYS = new Set([
  'reason',
  'outcome',
  'ok',
  'mode',
  'cache',
  'is_first',
  'plan',
  'source',
  'provider',
  'failure_reason',
  'result_type',
  'duration_bucket',
  'install_id',
]);

const SENSITIVE_KEY =
  /url|title|review|product[_-]?id|email|cookie|prompt|license|chat|password|token|pan/i;

interface FunnelFlags {
  firstCompareDone?: boolean;
  firstAiDone?: boolean;
}

async function readFlags(): Promise<FunnelFlags> {
  try {
    const stored = await chrome.storage.local.get(FUNNEL_FLAGS_KEY);
    return (stored[FUNNEL_FLAGS_KEY] as FunnelFlags) ?? {};
  } catch {
    return {};
  }
}

async function writeFlags(patch: FunnelFlags): Promise<void> {
  try {
    const prev = await readFlags();
    await chrome.storage.local.set({ [FUNNEL_FLAGS_KEY]: { ...prev, ...patch } });
  } catch {
    // soft
  }
}

/** Short non-reversible article fingerprint (marketplace + article only). */
function articleFingerprint(marketplace: string, article: string): string {
  const s = `${marketplace}:${article}`.toLowerCase();
  let h = 0x811c9dc5;
  for (let i = 0; i < Math.min(s.length, 80); i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `a${(h >>> 0).toString(16)}`;
}

export function durationBucket(ms: number): FunnelDurationBucket {
  if (!Number.isFinite(ms) || ms < 1000) return 'lt_1s';
  if (ms < 3000) return '1_3s';
  if (ms < 10_000) return '3_10s';
  if (ms < 30_000) return '10_30s';
  return '30s_plus';
}

export function classifyFailureReason(
  input?: unknown,
  hint?: CompareOutcome,
): FunnelFailureReason {
  if (hint === 'not_found') return 'product_not_found';
  if (hint === 'needs_choice') return 'matching_failed';
  const s = String(input instanceof Error ? input.message : (input ?? '')).toLowerCase();
  if (!s.trim()) return hint === 'error' ? 'unknown' : 'unknown';
  if (/timeout|timed out|превышено время/.test(s)) return 'timeout';
  if (/network|fetch|econn|offline|нет сети|cors|failed to fetch/.test(s)) return 'network_error';
  if (/parse|parser|json/.test(s)) return 'parser_error';
  if (/unavailable|503|502|blocked|captcha|marketplace/.test(s)) return 'marketplace_unavailable';
  if (/not found|не найден|no results|product_not_found/.test(s)) return 'product_not_found';
  if (/match|категор|отклон|confidence/.test(s)) return 'matching_failed';
  return 'unknown';
}

export function sanitizeFunnelData(
  data?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!data) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (SENSITIVE_KEY.test(key)) continue;
    if (!FUNNEL_DATA_KEYS.has(key)) continue;
    if (value == null) continue;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      out[key] = value;
    }
  }
  return Object.keys(out).length ? out : undefined;
}

function allowedMarketplace(marketplace?: string): string | undefined {
  const mp = marketplace?.trim();
  if (mp && ALLOWED_MARKETPLACES.has(mp)) return mp;
  return undefined;
}

function emit(
  name: FunnelEventName,
  data?: Record<string, unknown>,
  opts?: { marketplace?: string; success?: boolean; elapsedMs?: number },
): void {
  try {
    const marketplace = allowedMarketplace(opts?.marketplace);
    telemetry.info({
      stage: 'system',
      name,
      funnel: true,
      marketplace,
      success: opts?.success,
      elapsedMs: opts?.elapsedMs,
      productId: undefined,
      data: sanitizeFunnelData(data),
    });
  } catch {
    // telemetry must never break product flow
  }
}

export function trackExtensionInstalled(reason: FunnelInstallReason | string): void {
  const allowed =
    reason === 'install' ||
    reason === 'update' ||
    reason === 'chrome_update' ||
    reason === 'shared_module_update'
      ? reason
      : 'install';
  emit('extension_installed', { reason: allowed });
}

/** Popup mount — at most once per browser session. */
export async function trackExtensionStarted(): Promise<void> {
  try {
    const stored = await chrome.storage.session.get(SESSION_STARTED_KEY);
    if (stored[SESSION_STARTED_KEY]) return;
    await chrome.storage.session.set({ [SESSION_STARTED_KEY]: true });
  } catch {
    // still emit once this call
  }
  emit('extension_started');
}

export async function trackProductCardOpened(
  marketplace: Marketplace | string | undefined,
  article?: string,
): Promise<void> {
  const mp = marketplace?.trim();
  if (!mp) return;

  if (article?.trim()) {
    try {
      const fp = articleFingerprint(mp, article.trim());
      const key = `${mp}:${fp}`;
      const stored = await chrome.storage.local.get(CARD_OPEN_DEDUPE_KEY);
      const map = (stored[CARD_OPEN_DEDUPE_KEY] as Record<string, number>) ?? {};
      const now = Date.now();
      if (map[key] && now - map[key]! < CARD_DEDUPE_TTL_MS) return;
      map[key] = now;
      for (const [k, ts] of Object.entries(map)) {
        if (now - ts > CARD_DEDUPE_TTL_MS) delete map[k];
      }
      await chrome.storage.local.set({ [CARD_OPEN_DEDUPE_KEY]: map });
    } catch {
      // still emit once without dedupe
    }
  }

  emit('product_card_opened', undefined, { marketplace: mp });
  emit('marketplace_page_detected', undefined, { marketplace: mp });
}

export async function trackCompareStarted(marketplace?: string): Promise<void> {
  const flags = await readFlags();
  const isFirst = !flags.firstCompareDone;
  if (isFirst) await writeFlags({ firstCompareDone: true });
  emit('compare_started', { is_first: isFirst }, { marketplace });
}

export function trackCompareCompleted(
  outcome: CompareOutcome,
  marketplace?: string,
  extra?: { durationMs?: number; failureReason?: FunnelFailureReason },
): void {
  const duration_bucket =
    extra?.durationMs != null ? durationBucket(extra.durationMs) : undefined;
  emit(
    'compare_completed',
    { outcome, ...(duration_bucket ? { duration_bucket } : {}) },
    { marketplace, success: outcome === 'success', elapsedMs: extra?.durationMs },
  );
  if (outcome === 'error' || outcome === 'not_found') {
    emit(
      'comparison_failed',
      {
        failure_reason:
          extra?.failureReason ??
          classifyFailureReason(undefined, outcome),
        ...(duration_bucket ? { duration_bucket } : {}),
        result_type: outcome === 'not_found' ? 'not_found' : undefined,
      },
      { marketplace, success: false, elapsedMs: extra?.durationMs },
    );
  }
}

export function trackComparisonFailed(
  reason: FunnelFailureReason,
  marketplace?: string,
  durationMs?: number,
): void {
  emit(
    'comparison_failed',
    {
      failure_reason: reason,
      ...(durationMs != null ? { duration_bucket: durationBucket(durationMs) } : {}),
    },
    { marketplace, success: false, elapsedMs: durationMs },
  );
}

export function trackCompareRejected(marketplace?: string): void {
  emit('compare_rejected', undefined, { marketplace, success: false });
  emit(
    'match_failed',
    { failure_reason: 'matching_failed', result_type: 'not_found' },
    { marketplace, success: false },
  );
}

export function trackCompareCandidateSelected(marketplace?: string): void {
  emit('compare_candidate_selected', undefined, { marketplace, success: true });
  emit('match_completed', { result_type: 'candidate' }, { marketplace, success: true });
}

export function trackMatchManualSelection(marketplace?: string): void {
  emit('match_manual_selection', { result_type: 'manual' }, { marketplace, success: true });
}

export async function trackAiStarted(opts: {
  mode: 'preview' | 'full';
  cache: 'hit' | 'miss' | 'unknown';
  provider?: string;
}): Promise<void> {
  const flags = await readFlags();
  const isFirst = !flags.firstAiDone;
  if (isFirst) await writeFlags({ firstAiDone: true });
  const source: FunnelAiSource | undefined =
    opts.cache === 'hit' ? 'cache' : opts.cache === 'miss' ? 'generate' : undefined;
  emit('ai_started', {
    is_first: isFirst,
    mode: opts.mode,
    cache: opts.cache,
    ...(source ? { source } : {}),
    ...(opts.provider ? { provider: opts.provider } : {}),
  });
  if (opts.mode === 'full' && opts.cache === 'hit') {
    emit('ai_analysis_cache_hit', {
      source: 'cache',
      ...(opts.provider ? { provider: opts.provider } : {}),
    });
  }
  if (opts.mode === 'full') {
    emit(
      'ai_analysis_completed',
      {
        source: source ?? 'generate',
        ...(opts.provider ? { provider: opts.provider } : {}),
      },
      { success: true },
    );
  }
}

export function trackAiAnalysisStarted(): void {
  emit('ai_analysis_started');
}

export function trackAiAnalysisFailed(reason?: FunnelFailureReason, provider?: string): void {
  emit(
    'ai_analysis_failed',
    {
      failure_reason: reason ?? 'unknown',
      ...(provider ? { provider } : {}),
    },
    { success: false },
  );
}

export function trackProductTrackingAdded(marketplace?: string): void {
  emit('product_tracking_added', undefined, { marketplace, success: true });
}

export function trackProductTrackingRemoved(marketplace?: string): void {
  emit('product_tracking_removed', undefined, { marketplace });
}

export function trackMonitoringRefresh(ok: boolean, durationMs?: number, reason?: FunnelFailureReason): void {
  if (ok) {
    emit(
      'monitoring_refresh',
      durationMs != null ? { duration_bucket: durationBucket(durationMs) } : undefined,
      { success: true, elapsedMs: durationMs },
    );
    return;
  }
  emit(
    'monitoring_refresh_failed',
    {
      failure_reason: reason ?? 'unknown',
      ...(durationMs != null ? { duration_bucket: durationBucket(durationMs) } : {}),
    },
    { success: false, elapsedMs: durationMs },
  );
}

export function trackTelegramConnectStarted(): void {
  emit('telegram_connect_started');
}

export function trackTelegramLinked(ok: boolean): void {
  emit('telegram_linked', { ok }, { success: ok });
  if (ok) emit('telegram_connected', { ok: true }, { success: true });
}

export function trackTelegramDisconnected(): void {
  emit('telegram_disconnected');
}

export function trackTrialClaimed(ok: boolean): void {
  emit('trial_claimed', { ok }, { success: ok });
}

export function trackCheckoutStarted(plan: PremiumPlanId | string): void {
  const p = plan === 'yearly' || plan === 'monthly' || plan === 'lifetime' ? plan : 'monthly';
  emit('checkout_started', { plan: p });
}

export function trackPremiumActive(source: 'license' | 'trial' | 'payment'): void {
  emit('premium_active', { source }, { success: true });
}

export function trackPremiumPageOpened(): void {
  emit('premium_page_opened');
}

/** Derive coarse compare outcome from offer match statuses (no titles/URLs). */
export function compareOutcomeFromOfferStatuses(
  statuses: Array<string | undefined>,
): CompareOutcome {
  if (!statuses.length) return 'error';
  if (statuses.some((s) => s === 'needs_choice')) return 'needs_choice';
  if (statuses.some((s) => s === 'verified' || s === 'probable' || s === 'serp_only')) {
    return 'success';
  }
  if (statuses.every((s) => s === 'not_found' || s === 'oos' || s === 'blocked')) {
    return 'not_found';
  }
  return 'error';
}
