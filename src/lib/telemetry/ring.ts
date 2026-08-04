/**
 * Local telemetry ring buffer in chrome.storage.local.
 * Batched writes; drops oldest INFO first when over cap.
 */

import { TELEMETRY_RING_KEY, type TelemetryEvent, type TelemetryLevel } from './types';

const MAX_EVENTS = 400;
const MAX_BYTES_SOFT = 450_000;
const FLUSH_DEBOUNCE_MS = 350;

let pending: TelemetryEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let writeChain: Promise<void> = Promise.resolve();

function estimateBytes(events: TelemetryEvent[]): number {
  try {
    return JSON.stringify(events).length;
  } catch {
    return events.length * 400;
  }
}

function trimRing(events: TelemetryEvent[]): TelemetryEvent[] {
  let list = events.slice(-MAX_EVENTS);
  while (list.length > 50 && estimateBytes(list) > MAX_BYTES_SOFT) {
    const infoIdx = list.findIndex((e) => e.level === 'info');
    if (infoIdx >= 0) {
      list = [...list.slice(0, infoIdx), ...list.slice(infoIdx + 1)];
    } else {
      list = list.slice(Math.floor(list.length * 0.1));
    }
  }
  return list;
}

async function readRing(): Promise<TelemetryEvent[]> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return [];
  try {
    const stored = await chrome.storage.local.get(TELEMETRY_RING_KEY);
    const raw = stored[TELEMETRY_RING_KEY];
    return Array.isArray(raw) ? (raw as TelemetryEvent[]) : [];
  } catch {
    return [];
  }
}

async function writeRing(events: TelemetryEvent[]): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
  try {
    await chrome.storage.local.set({ [TELEMETRY_RING_KEY]: trimRing(events) });
  } catch {
    // storage full — drop half of INFO then retry once
    try {
      const trimmed = events.filter((e, i) => e.level !== 'info' || i % 2 === 0);
      await chrome.storage.local.set({ [TELEMETRY_RING_KEY]: trimRing(trimmed) });
    } catch {
      // give up
    }
  }
}

function scheduleFlush(): void {
  if (flushTimer != null) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    writeChain = writeChain.then(async () => {
      if (pending.length === 0) return;
      const batch = pending;
      pending = [];
      const cur = await readRing();
      await writeRing([...cur, ...batch]);
    });
  }, FLUSH_DEBOUNCE_MS);
}

/** Fire-and-forget append (batched). */
export function appendTelemetryEvent(event: TelemetryEvent): void {
  pending.push(event);
  if (pending.length > 80) {
    // emergency: keep WARN/ERROR in pending
    pending = pending.filter((e) => e.level !== 'info').slice(-40);
  }
  scheduleFlush();
}

export async function readTelemetryEvents(limit = 200): Promise<TelemetryEvent[]> {
  // flush pending first
  if (pending.length) {
    const batch = pending;
    pending = [];
    const cur = await readRing();
    await writeRing([...cur, ...batch]);
  }
  const all = await readRing();
  return all.slice(-limit);
}

export async function clearTelemetryRing(): Promise<void> {
  pending = [];
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
  await chrome.storage.local.remove(TELEMETRY_RING_KEY);
}

export async function countTelemetryByLevel(): Promise<Record<TelemetryLevel, number>> {
  const events = await readTelemetryEvents(MAX_EVENTS);
  const out: Record<TelemetryLevel, number> = { info: 0, warn: 0, error: 0 };
  for (const e of events) out[e.level] = (out[e.level] ?? 0) + 1;
  return out;
}
