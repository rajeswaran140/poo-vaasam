/** @jest-environment node */
/**
 * In-process TTL memo used to keep the admin dashboards from re-running their
 * whole fan-out on every load and range toggle. The in-flight sharing is the
 * part that matters most: it's what stops a double-click from issuing two
 * parallel GA4 batches and blowing the property's 10-concurrent-request quota.
 */

import { cached, clearCache } from '@/lib/ttl-cache';

beforeEach(() => {
  clearCache();
  jest.useRealTimers();
});

it('calls the fetcher once and serves the cached value within the TTL', async () => {
  const fetcher = jest.fn().mockResolvedValue('v1');
  expect(await cached('k', 60_000, fetcher)).toBe('v1');
  expect(await cached('k', 60_000, fetcher)).toBe('v1');
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('re-fetches once the TTL has elapsed', async () => {
  const fetcher = jest.fn().mockResolvedValueOnce('v1').mockResolvedValueOnce('v2');
  const nowSpy = jest.spyOn(Date, 'now');

  nowSpy.mockReturnValue(1_000);
  expect(await cached('k', 60_000, fetcher)).toBe('v1');

  nowSpy.mockReturnValue(1_000 + 60_001);
  expect(await cached('k', 60_000, fetcher)).toBe('v2');
  expect(fetcher).toHaveBeenCalledTimes(2);

  nowSpy.mockRestore();
});

it('keys entries independently, so each range caches on its own', async () => {
  const fetcher = jest.fn().mockImplementation((v: string) => Promise.resolve(v));
  expect(await cached('ga4:7', 60_000, () => fetcher('seven'))).toBe('seven');
  expect(await cached('ga4:28', 60_000, () => fetcher('twentyeight'))).toBe('twentyeight');
  expect(await cached('ga4:7', 60_000, () => fetcher('seven-again'))).toBe('seven');
  expect(fetcher).toHaveBeenCalledTimes(2);
});

// The whole point: two concurrent callers must not both fan out.
it('shares an in-flight request instead of starting a second fetch', async () => {
  let resolveIt: (v: string) => void = () => {};
  const fetcher = jest.fn().mockImplementation(
    () => new Promise<string>((resolve) => { resolveIt = resolve; })
  );

  const a = cached('k', 60_000, fetcher);
  const b = cached('k', 60_000, fetcher);
  expect(fetcher).toHaveBeenCalledTimes(1);

  resolveIt('shared');
  expect(await a).toBe('shared');
  expect(await b).toBe('shared');
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('never caches a rejection — the next caller retries', async () => {
  const fetcher = jest
    .fn()
    .mockRejectedValueOnce(new Error('GA4 RESOURCE_EXHAUSTED'))
    .mockResolvedValueOnce('recovered');

  await expect(cached('k', 60_000, fetcher)).rejects.toThrow('RESOURCE_EXHAUSTED');
  expect(await cached('k', 60_000, fetcher)).toBe('recovered');
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it('propagates a rejection to every sharer of the same in-flight request', async () => {
  const fetcher = jest.fn().mockRejectedValue(new Error('boom'));
  const a = cached('k', 60_000, fetcher);
  const b = cached('k', 60_000, fetcher);
  await expect(a).rejects.toThrow('boom');
  await expect(b).rejects.toThrow('boom');
  expect(fetcher).toHaveBeenCalledTimes(1);
});
