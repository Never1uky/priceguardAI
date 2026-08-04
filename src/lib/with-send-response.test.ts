import { describe, expect, it, vi } from 'vitest';
import { withSendResponse, withSendResponseOk } from '@/lib/with-send-response';

describe('withSendResponse', () => {
  it('forwards respond() once', async () => {
    const send = vi.fn();
    withSendResponse(send, async (respond) => {
      respond({ ok: true, n: 1 });
      respond({ ok: true, n: 2 });
    });
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send).toHaveBeenCalledWith({ ok: true, n: 1 });
  });

  it('catches thrown errors', async () => {
    const send = vi.fn();
    withSendResponse(send, async () => {
      throw new Error('boom');
    });
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send).toHaveBeenCalledWith({ ok: false, error: 'boom' });
  });

  it('responds if work forgets to call respond', async () => {
    const send = vi.fn();
    withSendResponse(send, async () => {
      /* no respond */
    });
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send).toHaveBeenCalledWith({
      ok: false,
      error: 'Internal: handler did not respond',
    });
  });

  it('withSendResponseOk maps resolve/reject', async () => {
    const send = vi.fn();
    withSendResponseOk(send, async () => ({ count: 3 }));
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith({ ok: true, count: 3 }));

    const send2 = vi.fn();
    withSendResponseOk(send2, async () => {
      throw new Error('fail');
    });
    await vi.waitFor(() => expect(send2).toHaveBeenCalledWith({ ok: false, error: 'fail' }));
  });
});
