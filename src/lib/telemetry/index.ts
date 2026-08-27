/**
 * Unified telemetry API for PriceGuard AI.
 * Never await on hot paths — all writes are fire-and-forget.
 *
 * Note: edge.ts must import from `./log` (not this barrel) to avoid SW cycles.
 */

export type {
  TelemetryEvent,
  TelemetryLevel,
  TelemetryMode,
  TelemetrySettings,
  TelemetryStage,
} from './types';

export {
  ensureSessionId,
  loadTelemetrySettings,
  saveTelemetrySettings,
  setTelemetryContext,
  clearTelemetryContext,
  newTraceId,
  getSessionIdSync,
} from './context';

export { readTelemetryEvents, clearTelemetryRing, countTelemetryByLevel } from './ring';
export { hashQuery, redactUrl, truncateTitle } from './redact';
export { buildDiagnosticsPackage, diagnosticsJsonString } from './export';
export { flushRemoteTelemetry, reportSearchMetric, enqueueRemoteTelemetry } from './flush';
export { telemetry } from './log';
export type { TelemetryLogInput } from './log';
export { trackCompareMpAttempt } from './compare-mp-attempt';
export type { CompareMpAttemptPath } from './compare-mp-attempt';
export {
  trackOpsMetric,
  trackMarketplaceSearchStarted,
  trackMarketplaceSearchFinished,
  trackScrapeCacheHit,
  trackScrapeCacheMiss,
  trackScrapeRequest,
  trackTelegramAlertSent,
  OPS_EVENT_NAMES,
} from './ops';
export type { OpsEventName, OpsAlertType, OpsContext, OpsScrapeSource } from './ops';
export {
  trackExtensionInstalled,
  trackExtensionStarted,
  trackProductCardOpened,
  trackCompareStarted,
  trackCompareCompleted,
  trackComparisonFailed,
  trackCompareRejected,
  trackCompareCandidateSelected,
  trackMatchManualSelection,
  trackAiStarted,
  trackAiAnalysisStarted,
  trackAiAnalysisFailed,
  trackProductTrackingAdded,
  trackProductTrackingRemoved,
  trackMonitoringRefresh,
  trackTelegramConnectStarted,
  trackTelegramLinked,
  trackTelegramDisconnected,
  trackTrialClaimed,
  trackCheckoutStarted,
  trackPremiumActive,
  trackPremiumPageOpened,
  compareOutcomeFromOfferStatuses,
  classifyFailureReason,
  durationBucket,
  sanitizeFunnelData,
  isFunnelEventName,
} from './funnel';
export type {
  CompareOutcome,
  FunnelInstallReason,
  FunnelFailureReason,
  FunnelDurationBucket,
} from './funnel';
