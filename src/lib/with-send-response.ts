/**
 * Once-safe async reply for chrome.runtime.onMessage handlers that return `true`.
 * Guarantees sendResponse is called exactly once (ok or error) so popup never hangs.
 */

export type SendResponseFn = (response?: unknown) => void;

function errorPayload(error: unknown): { ok: false; error: string } {
  return {
    ok: false,
    error: error instanceof Error ? error.message : String(error ?? 'Unknown error'),
  };
}

/**
 * Run async work that must call `respond` itself. If it throws or forgets to respond,
 * a failure payload is sent once.
 */
export function withSendResponse(
  sendResponse: SendResponseFn,
  work: (respond: SendResponseFn) => Promise<void>,
): boolean {
  let sent = false;
  const respond: SendResponseFn = (payload) => {
    if (sent) return;
    sent = true;
    try {
      sendResponse(payload);
    } catch {
      // Port closed — ignore
    }
  };

  void (async () => {
    try {
      await work(respond);
    } catch (error) {
      respond(errorPayload(error));
    } finally {
      if (!sent) respond({ ok: false, error: 'Internal: handler did not respond' });
    }
  })();

  return true;
}

/**
 * Fire-and-forget style: resolve → `{ ok: true, ...data }`, reject → `{ ok: false, error }`.
 */
export function withSendResponseOk(
  sendResponse: SendResponseFn,
  work: () => Promise<Record<string, unknown> | void>,
): boolean {
  return withSendResponse(sendResponse, async (respond) => {
    const data = await work();
    respond(data && typeof data === 'object' ? { ok: true, ...data } : { ok: true });
  });
}
