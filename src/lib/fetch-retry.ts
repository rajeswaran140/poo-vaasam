/**
 * fetchWithRetry — small resilience wrapper around fetch for the YouTube/Google
 * REST clients. A single transient blip (429 / 5xx / dropped connection) was
 * failing a whole admin dashboard render; this retries those with exponential
 * backoff. Permanent failures (4xx like 400 invalid_grant, 401, 404) are NOT
 * retried — they return immediately so the caller's normal handling runs.
 *
 * The Google Analytics SDK (ga4-api.ts) has its own retry layer, so it doesn't
 * use this. `sleep` is injectable for deterministic tests.
 */

export interface RetryOptions {
  /** Extra attempts after the first try (default 2 → up to 3 total). */
  retries?: number;
  /** Base backoff in ms; grows base·2^attempt, capped at 4s (default 300). */
  baseDelayMs?: number;
  /** Override which HTTP statuses are retryable (default 429 + 5xx). */
  retryOn?: (status: number) => boolean;
  /** Injectable delay (tests pass a no-op). */
  sleep?: (ms: number) => Promise<void>;
}

const defaultRetryable = (s: number) => s === 429 || (s >= 500 && s <= 599);
const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function backoffDelay(baseMs: number, attempt: number): number {
  return Math.min(baseMs * 2 ** attempt, 4000);
}

export async function fetchWithRetry(
  input: string | URL,
  init?: RequestInit,
  opts: RetryOptions = {}
): Promise<Response> {
  const retries = opts.retries ?? 2;
  const base = opts.baseDelayMs ?? 300;
  const retryOn = opts.retryOn ?? defaultRetryable;
  const sleep = opts.sleep ?? realSleep;

  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(input, init);
      // Retry transient statuses while attempts remain; otherwise hand back the
      // response (even a 5xx) so the caller handles it as it always has.
      if (attempt < retries && retryOn(res.status)) {
        await sleep(backoffDelay(base, attempt));
        continue;
      }
      return res;
    } catch (err) {
      // Network-level failure — retry if attempts remain, else rethrow.
      lastErr = err;
      if (attempt < retries) {
        await sleep(backoffDelay(base, attempt));
        continue;
      }
      throw err;
    }
  }
  // Unreachable (loop returns or throws), but keeps TS happy.
  throw lastErr ?? new Error('fetchWithRetry: exhausted retries');
}
