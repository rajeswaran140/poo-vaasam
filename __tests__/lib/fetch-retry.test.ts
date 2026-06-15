/** @jest-environment node */
import { fetchWithRetry, backoffDelay } from '@/lib/fetch-retry';

const noSleep = () => Promise.resolve();
const resp = (status: number) => new Response('x', { status });

afterEach(() => jest.restoreAllMocks());

describe('backoffDelay', () => {
  it('grows exponentially and caps at 4s', () => {
    expect(backoffDelay(300, 0)).toBe(300);
    expect(backoffDelay(300, 1)).toBe(600);
    expect(backoffDelay(300, 2)).toBe(1200);
    expect(backoffDelay(300, 10)).toBe(4000); // capped
  });
});

describe('fetchWithRetry', () => {
  it('retries a transient 503 then returns the eventual 200', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(resp(503))
      .mockResolvedValueOnce(resp(200));
    global.fetch = fetchMock as unknown as typeof fetch;

    const res = await fetchWithRetry('http://x', undefined, { sleep: noSleep });
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry a 4xx (e.g. 400 invalid_grant) — returns immediately', async () => {
    const fetchMock = jest.fn().mockResolvedValue(resp(400));
    global.fetch = fetchMock as unknown as typeof fetch;

    const res = await fetchWithRetry('http://x', undefined, { sleep: noSleep });
    expect(res.status).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry a 401', async () => {
    const fetchMock = jest.fn().mockResolvedValue(resp(401));
    global.fetch = fetchMock as unknown as typeof fetch;
    const res = await fetchWithRetry('http://x', undefined, { sleep: noSleep });
    expect(res.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns the final 5xx after exhausting retries (does not throw on status)', async () => {
    const fetchMock = jest.fn().mockResolvedValue(resp(500));
    global.fetch = fetchMock as unknown as typeof fetch;

    const res = await fetchWithRetry('http://x', undefined, { retries: 2, sleep: noSleep });
    expect(res.status).toBe(500);
    expect(fetchMock).toHaveBeenCalledTimes(3); // 1 + 2 retries
  });

  it('retries a network error then succeeds', async () => {
    const fetchMock = jest.fn()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce(resp(200));
    global.fetch = fetchMock as unknown as typeof fetch;

    const res = await fetchWithRetry('http://x', undefined, { sleep: noSleep });
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rethrows a persistent network error after exhausting retries', async () => {
    const fetchMock = jest.fn().mockRejectedValue(new Error('down'));
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(fetchWithRetry('http://x', undefined, { retries: 1, sleep: noSleep })).rejects.toThrow('down');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
