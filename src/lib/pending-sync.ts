/**
 * Durable outbox for Edge write-ops. Survives SW restart via chrome.storage.local.
 * Local UX applies first; cloud catches up via flushPendingSync.
 */

import type { NetworkFailureKind } from '@/lib/fetch-retry';

const QUEUE_KEY = 'priceguard_pending_sync_v1';
const MAX_ITEMS = 50;
const MAX_ATTEMPTS = 8;
export const PENDING_SYNC_ALARM = 'priceguard-pending-sync';

export type PendingSyncOp = 'compare_sync' | 'price_cache_put';

export interface PendingSyncItem {
  id: string;
  op: PendingSyncOp;
  dedupeKey: string;
  payload: unknown;
  createdAt: number;
  attempts: number;
  nextAttemptAt: number;
  lastErrorKind?: NetworkFailureKind | string;
}

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function backoffMs(attempts: number): number {
  const base = 2_000 * 2 ** Math.min(attempts, 6);
  const jitter = base * 0.2 * (Math.random() * 2 - 1);
  return Math.min(Math.round(base + jitter), 15 * 60_000);
}

async function readQueue(): Promise<PendingSyncItem[]> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return [];
  try {
    const stored = await chrome.storage.local.get(QUEUE_KEY);
    const list = stored[QUEUE_KEY];
    return Array.isArray(list) ? (list as PendingSyncItem[]) : [];
  } catch {
    return [];
  }
}

async function writeQueue(items: PendingSyncItem[]): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
  await chrome.storage.local.set({ [QUEUE_KEY]: items.slice(0, MAX_ITEMS) });
}

/** Enqueue or replace by dedupeKey (last-write-wins). */
export async function enqueuePendingSync(
  op: PendingSyncOp,
  dedupeKey: string,
  payload: unknown,
): Promise<void> {
  const list = await readQueue();
  const filtered = list.filter((x) => x.dedupeKey !== dedupeKey);
  filtered.unshift({
    id: newId(),
    op,
    dedupeKey,
    payload,
    createdAt: Date.now(),
    attempts: 0,
    nextAttemptAt: Date.now(),
  });
  await writeQueue(filtered);
  void schedulePendingSyncAlarm();
}

export async function peekPendingSync(): Promise<PendingSyncItem[]> {
  return readQueue();
}

export async function schedulePendingSyncAlarm(): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.alarms) return;
  try {
    await chrome.alarms.create(PENDING_SYNC_ALARM, { delayInMinutes: 0.5 });
  } catch {
    // ignore
  }
}

type FlushHandler = (item: PendingSyncItem) => Promise<'ok' | 'retry' | 'drop'>;

const handlers = new Map<PendingSyncOp, FlushHandler>();

/** Register op handler (called from modules that own the Edge write). */
export function registerPendingSyncHandler(op: PendingSyncOp, handler: FlushHandler): void {
  handlers.set(op, handler);
}

/**
 * Flush due items. Returns counts for telemetry/tests.
 */
export async function flushPendingSync(opts?: {
  maxItems?: number;
  now?: number;
}): Promise<{ ok: number; retry: number; drop: number }> {
  const now = opts?.now ?? Date.now();
  const maxItems = opts?.maxItems ?? 5;
  let list = await readQueue();
  const due = list
    .filter((x) => x.nextAttemptAt <= now)
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(0, maxItems);

  let ok = 0;
  let retry = 0;
  let drop = 0;

  for (const item of due) {
    const handler = handlers.get(item.op);
    if (!handler) {
      // No handler registered yet — keep for later
      continue;
    }

    let outcome: 'ok' | 'retry' | 'drop' = 'retry';
    try {
      outcome = await handler(item);
    } catch {
      outcome = 'retry';
    }

    list = await readQueue();
    if (outcome === 'ok') {
      ok += 1;
      list = list.filter((x) => x.id !== item.id);
    } else if (outcome === 'drop' || item.attempts + 1 >= MAX_ATTEMPTS) {
      drop += 1;
      list = list.filter((x) => x.id !== item.id);
      console.debug(
        `[PriceGuard] PendingSync drop ${item.op}:${item.dedupeKey} after ${item.attempts + 1} attempts`,
      );
    } else {
      retry += 1;
      list = list.map((x) =>
        x.id === item.id
          ? {
              ...x,
              attempts: x.attempts + 1,
              nextAttemptAt: now + backoffMs(x.attempts + 1),
              lastErrorKind: 'http5xx',
            }
          : x,
      );
    }
    await writeQueue(list);
  }

  const remaining = (await readQueue()).filter((x) => x.nextAttemptAt <= Date.now() + 60_000);
  if (remaining.length) void schedulePendingSyncAlarm();

  return { ok, retry, drop };
}

/** Test helper: clear queue. */
export async function clearPendingSyncForTests(): Promise<void> {
  await writeQueue([]);
}
