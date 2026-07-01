/**
 * Shared client-side polling for the async AI-job forms (Composer, Lyric
 * Critic). Both enqueue a job then poll a status endpoint until it reaches a
 * terminal state; this centralises the abort-aware sleep + poll loop so the two
 * forms don't drift (they previously duplicated it verbatim).
 */

export interface JobStatusBody<T> {
  status?: string;
  result?: T;
  error?: { code?: string; message?: string };
}

/** Sleep that resolves early if the request is aborted (unmount / supersede). */
export function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true }
    );
  });
}

export interface PollJobOptions {
  /** Fetch the job status once (caller supplies e.g. adminFetch(url, {signal})). */
  fetchStatus: (signal: AbortSignal) => Promise<Response>;
  signal: AbortSignal;
  /** Bail (return undefined) when the component has unmounted. */
  isMounted: () => boolean;
  intervalMs: number;
  timeoutMs: number;
  timeoutMessage: string;
}

/**
 * Poll until the job is terminal.
 *  - resolves with `result` on `status:'done'`
 *  - throws on `status:'error'` (Error carries `.code`) or when the deadline passes
 *  - resolves `undefined` if superseded/unmounted (caller should bail silently)
 */
export async function pollJob<T>(opts: PollJobOptions): Promise<T | undefined> {
  const deadline = Date.now() + opts.timeoutMs;
  for (;;) {
    if (opts.signal.aborted || !opts.isMounted()) return undefined;
    const res = await opts.fetchStatus(opts.signal);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `HTTP ${res.status}`);
    }
    const body = (await res.json()) as JobStatusBody<T>;
    if (body.status === 'done' && body.result !== undefined && body.result !== null) {
      return body.result;
    }
    if (body.status === 'error') {
      throw Object.assign(new Error(body.error?.message || 'Job failed'), {
        code: body.error?.code,
      });
    }
    if (Date.now() > deadline) throw new Error(opts.timeoutMessage);
    await delay(opts.intervalMs, opts.signal);
  }
}
