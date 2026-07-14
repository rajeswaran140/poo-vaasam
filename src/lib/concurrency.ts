/**
 * Bounded-concurrency map. The YouTube Analytics API is per-video for some
 * metrics (shares), so a leaderboard over the whole catalogue means one call per
 * song. Firing those with a bare `Promise.all` opens ~70 sockets at once and
 * invites 429s/timeouts against Amplify's ~30s origin budget — and a throttled
 * call that degrades to "0 shares" silently corrupts the ranking.
 *
 * Runs at most `limit` tasks at a time, preserving input order in the output.
 * Never rejects: a throwing task resolves to `undefined` in its slot, so one bad
 * item can't sink the batch — callers distinguish failure from a real zero.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<Array<R | undefined>> {
  const n = items.length;
  const results: Array<R | undefined> = new Array(n);
  if (n === 0) return results;

  const max = Math.max(1, Math.min(Math.floor(limit) || 1, n));
  let next = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= n) return;
      try {
        results[i] = await fn(items[i], i);
      } catch {
        results[i] = undefined; // caller treats undefined as "unknown", not zero
      }
    }
  }

  await Promise.all(Array.from({ length: max }, () => worker()));
  return results;
}
