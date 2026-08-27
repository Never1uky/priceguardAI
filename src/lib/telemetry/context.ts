import {
  DEFAULT_TELEMETRY_SETTINGS,
  TELEMETRY_SESSION_KEY,
  TELEMETRY_SETTINGS_KEY,
  type TelemetryContextPatch,
  type TelemetrySettings,
} from './types';
import {
  detectBrowserLabelFromUa,
  readNavigatorUserAgent,
  type BrowserLabel,
} from '@/lib/browser-label';

export type { BrowserLabel };

let sessionIdMem: string | null = null;
let settingsMem: TelemetrySettings | null = null;
let contextMem: TelemetryContextPatch = {};

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function getExtensionVersion(): string {
  try {
    return chrome.runtime.getManifest().version;
  } catch {
    return 'unknown';
  }
}

/** Coarse browser for analytics: chrome | edge | yandex | unknown — never raw UA. */
export function getBrowserLabel(): BrowserLabel {
  return detectBrowserLabelFromUa(readNavigatorUserAgent());
}

export async function ensureSessionId(): Promise<string> {
  if (sessionIdMem) return sessionIdMem;
  try {
    const stored = await chrome.storage.session.get(TELEMETRY_SESSION_KEY);
    const existing = stored[TELEMETRY_SESSION_KEY];
    if (typeof existing === 'string' && existing.length > 0) {
      sessionIdMem = existing;
      return existing;
    }
  } catch {
    // session storage may be unavailable in some contexts
  }
  const id = newId();
  sessionIdMem = id;
  try {
    await chrome.storage.session.set({ [TELEMETRY_SESSION_KEY]: id });
  } catch {
    // keep in-memory
  }
  return id;
}

export function getSessionIdSync(): string {
  return sessionIdMem ?? 'pending';
}

export async function loadTelemetrySettings(): Promise<TelemetrySettings> {
  if (settingsMem) return settingsMem;
  try {
    const stored = await chrome.storage.local.get(TELEMETRY_SETTINGS_KEY);
    const raw = stored[TELEMETRY_SETTINGS_KEY] as Partial<TelemetrySettings> | undefined;
    settingsMem = {
      mode: raw?.mode === 'verbose' || raw?.mode === 'silent' ? raw.mode : 'normal',
      remoteEnabled: Boolean(raw?.remoteEnabled),
    };
  } catch {
    settingsMem = { ...DEFAULT_TELEMETRY_SETTINGS };
  }
  return settingsMem;
}

export async function saveTelemetrySettings(
  patch: Partial<TelemetrySettings>,
): Promise<TelemetrySettings> {
  const cur = await loadTelemetrySettings();
  const next: TelemetrySettings = {
    mode: patch.mode ?? cur.mode,
    remoteEnabled: patch.remoteEnabled ?? cur.remoteEnabled,
  };
  settingsMem = next;
  try {
    await chrome.storage.local.set({ [TELEMETRY_SETTINGS_KEY]: next });
  } catch {
    // ignore
  }
  return next;
}

export function setTelemetryContext(patch: TelemetryContextPatch): void {
  contextMem = { ...contextMem, ...patch };
}

export function clearTelemetryContext(keys?: Array<keyof TelemetryContextPatch>): void {
  if (!keys?.length) {
    contextMem = {};
    return;
  }
  const next = { ...contextMem };
  for (const k of keys) delete next[k];
  contextMem = next;
}

export function getTelemetryContext(): TelemetryContextPatch {
  return { ...contextMem };
}

/** New compare/job correlation id. */
export function newTraceId(): string {
  return newId();
}
