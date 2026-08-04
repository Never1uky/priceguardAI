/**
 * Telemetry types — local ring + opt-in remote WARN/ERROR.
 * Never put prompts, emails, or full tokenized URLs in `data`.
 */

export type TelemetryLevel = 'info' | 'warn' | 'error';

export type TelemetryMode = 'verbose' | 'normal' | 'silent';

export type TelemetryStage =
  | 'popup'
  | 'job'
  | 'cache'
  | 'edge'
  | 'search'
  | 'serp'
  | 'cascade'
  | 'match'
  | 'card'
  | 'parser'
  | 'ai'
  | 'telegram'
  | 'system';

export interface TelemetryEvent {
  id: string;
  ts: number;
  level: TelemetryLevel;
  stage: TelemetryStage;
  name: string;
  sessionId: string;
  traceId?: string;
  jobId?: string;
  userId?: string | null;
  extVersion: string;
  browser: string;
  marketplace?: string;
  productId?: string;
  queryHash?: string;
  success?: boolean;
  elapsedMs?: number;
  errorCode?: string;
  errorMessage?: string;
  /** Structured extras — keep small & redacted */
  data?: Record<string, unknown>;
  stack?: string;
}

export interface TelemetryContextPatch {
  traceId?: string;
  jobId?: string;
  userId?: string | null;
  marketplace?: string;
  productId?: string;
  queryHash?: string;
}

export interface TelemetrySettings {
  mode: TelemetryMode;
  /** Opt-in: flush WARN/ERROR to Supabase */
  remoteEnabled: boolean;
}

export const TELEMETRY_SETTINGS_KEY = 'priceguard_telemetry_settings';
export const TELEMETRY_RING_KEY = 'priceguard_telemetry_ring_v1';
export const TELEMETRY_SESSION_KEY = 'priceguard_telemetry_session_id';

export const DEFAULT_TELEMETRY_SETTINGS: TelemetrySettings = {
  mode: 'normal',
  remoteEnabled: false,
};
