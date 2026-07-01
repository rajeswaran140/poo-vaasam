/** @jest-environment jsdom */
/**
 * Unit tests for src/lib/poll-job.ts — the shared client poll loop used by the
 * Composer + Lyric Critic forms. Verifies terminal handling, error propagation
 * (with code), the deadline, and abort/unmount bail-out.
 */
import { pollJob, delay } from '@/lib/poll-job';

const resp = (body: unknown, ok = true, status = 200): Response =>
  ({ ok, status, json: async () => body }) as unknown as Response;

describe('pollJob', () => {
  it('resolves with the result once status is done', async () => {
    const statuses = [{ status: 'processing' }, { status: 'done', result: { emotion: 'காதல்' } }];
    let i = 0;
    const out = await pollJob<{ emotion: string }>({
      fetchStatus: async () => resp(statuses[i++]),
      signal: new AbortController().signal,
      isMounted: () => true,
      intervalMs: 1,
      timeoutMs: 5000,
      timeoutMessage: 'too slow',
    });
    expect(out).toEqual({ emotion: 'காதல்' });
    expect(i).toBe(2); // polled twice
  });

  it('throws with the code on a status:error terminal', async () => {
    await expect(
      pollJob({
        fetchStatus: async () => resp({ status: 'error', error: { code: 'rate_limit', message: 'slow down' } }),
        signal: new AbortController().signal,
        isMounted: () => true,
        intervalMs: 1,
        timeoutMs: 5000,
        timeoutMessage: 'too slow',
      })
    ).rejects.toMatchObject({ message: 'slow down', code: 'rate_limit' });
  });

  it('throws the timeout message once the deadline passes', async () => {
    await expect(
      pollJob({
        fetchStatus: async () => resp({ status: 'processing' }),
        signal: new AbortController().signal,
        isMounted: () => true,
        intervalMs: 1,
        timeoutMs: -1, // already past the deadline on the first check
        timeoutMessage: 'took too long',
      })
    ).rejects.toThrow('took too long');
  });

  it('surfaces an HTTP error from a non-ok status response', async () => {
    await expect(
      pollJob({
        fetchStatus: async () => resp({ error: 'boom' }, false, 502),
        signal: new AbortController().signal,
        isMounted: () => true,
        intervalMs: 1,
        timeoutMs: 5000,
        timeoutMessage: 'too slow',
      })
    ).rejects.toThrow('boom');
  });

  it('returns undefined (bails) when the request is aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const out = await pollJob({
      fetchStatus: async () => resp({ status: 'processing' }),
      signal: controller.signal,
      isMounted: () => true,
      intervalMs: 1,
      timeoutMs: 5000,
      timeoutMessage: 'too slow',
    });
    expect(out).toBeUndefined();
  });

  it('returns undefined (bails) when the component has unmounted', async () => {
    const out = await pollJob({
      fetchStatus: async () => resp({ status: 'processing' }),
      signal: new AbortController().signal,
      isMounted: () => false,
      intervalMs: 1,
      timeoutMs: 5000,
      timeoutMessage: 'too slow',
    });
    expect(out).toBeUndefined();
  });
});

describe('delay', () => {
  it('resolves immediately when the signal is already aborted', async () => {
    const c = new AbortController();
    c.abort();
    await expect(delay(10_000, c.signal)).resolves.toBeUndefined();
  });
});
