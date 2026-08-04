/**
 * Unified messaging + DOM readiness for MV3 content scripts.
 * Handles "Receiving end does not exist", reinject, and body-ready gates.
 */

import { agentLog } from '@/lib/debug-log';
import {
  isContextInvalidatedError,
  isExtensionContextValid,
  isReceivingEndError,
} from '@/lib/extension-context';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export { isReceivingEndError } from '@/lib/extension-context';

function getContentScriptFiles(): string[] {
  const scripts = chrome.runtime.getManifest().content_scripts;
  if (!scripts?.length) return [];
  return scripts[0].js ?? [];
}

/**
 * Wait until document has a body (main world via executeScript).
 * Returns false on timeout / inject failure.
 */
export async function waitForDomReady(
  tabId: number,
  opts: { timeoutMs?: number; pollMs?: number } = {},
): Promise<boolean> {
  const timeoutMs = opts.timeoutMs ?? 5_000;
  const pollMs = opts.pollMs ?? 200;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const [{ result } = { result: false }] = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          const ready =
            document.readyState === 'interactive' || document.readyState === 'complete';
          return Boolean(ready && document.body);
        },
      });
      if (result) return true;
    } catch {
      // tab may be closed / restricted
      return false;
    }
    await delay(pollMs);
  }
  return false;
}

async function pingContentScript(tabId: number): Promise<boolean> {
  try {
    const pong = (await chrome.tabs.sendMessage(tabId, { type: 'PING' })) as
      | { ok?: boolean }
      | undefined;
    return Boolean(pong?.ok);
  } catch {
    return false;
  }
}

/**
 * PING → inject once → waitForDomReady → PING again.
 */
export async function ensureContentScriptReady(tabId: number): Promise<boolean> {
  if (await pingContentScript(tabId)) {
    await waitForDomReady(tabId, { timeoutMs: 2_000 });
    return true;
  }

  const files = getContentScriptFiles();
  if (!files.length) return false;

  try {
    await chrome.scripting.executeScript({ target: { tabId }, files });
  } catch {
    return false;
  }

  await waitForDomReady(tabId, { timeoutMs: 5_000 });
  await delay(300);
  return pingContentScript(tabId);
}

export type SafeSendTarget =
  | { type: 'runtime' }
  | { type: 'tab'; tabId: number; frameId?: number };

export interface SafeSendOptions {
  retries?: number;
  reinject?: boolean;
  backoffMs?: number[];
  /** When true (default for tab), return null instead of throwing after budget. */
  softFail?: boolean;
}

/**
 * Safe sendMessage for popup/CS → SW or SW → tab.
 * Tab path: reinject on receiving_end. Runtime path: retry cold SW wake.
 */
export async function safeSendMessage<T = unknown>(
  target: SafeSendTarget,
  message: unknown,
  opts: SafeSendOptions = {},
): Promise<T | null> {
  const retries = opts.retries ?? 3;
  const backoffMs = opts.backoffMs ?? [200, 500, 1000];
  const reinject = opts.reinject ?? true;
  const softFail = opts.softFail ?? target.type === 'tab';

  if (target.type === 'runtime' && !isExtensionContextValid()) {
    return null;
  }

  let injected = false;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      if (target.type === 'runtime') {
        return (await chrome.runtime.sendMessage(message)) as T;
      }
      return (await chrome.tabs.sendMessage(target.tabId, message, {
        frameId: target.frameId ?? 0,
      })) as T;
    } catch (error) {
      lastError = error;

      if (isContextInvalidatedError(error)) {
        return null;
      }

      if (target.type === 'tab' && reinject && !injected && isReceivingEndError(error)) {
        injected = true;
        const ok = await ensureContentScriptReady(target.tabId);
        agentLog(
          'safe-messaging.ts:safeSendMessage',
          'reinject after receiving_end',
          { tabId: target.tabId, ok, attempt },
          'I',
        );
        if (ok) continue;
      }

      if (target.type === 'runtime' && isReceivingEndError(error) && attempt < retries) {
        await delay(backoffMs[Math.min(attempt, backoffMs.length - 1)] ?? 500);
        continue;
      }

      if (attempt < retries) {
        await delay(backoffMs[Math.min(attempt, backoffMs.length - 1)] ?? 400);
        continue;
      }
    }
  }

  if (softFail) return null;
  throw lastError instanceof Error
    ? lastError
    : new Error(String(lastError ?? 'sendMessage failed'));
}
