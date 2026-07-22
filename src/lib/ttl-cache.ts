/**
 * Tiny in-process TTL memo for expensive read-only fetches.
 *
 * Scoped deliberately: admin dashboards re-run the same wide aggregation on
 * every load and every range toggle, which is pure waste for data that changes
 * on a scale of minutes. This caches the *server-side* result only — nothing is
 * added to HTTP caching headers, so admin data never lands in a shared proxy or
 * the browser disk cache.
 *
 * Per-instance, like src/lib/rate-limit: Amplify SSR Lambdas don't share memory,
 * so a cold instance simply misses. That's the correct failure mode for a cache
 * (a miss costs a fetch), unlike a rate limiter (a miss costs enforcement).
 *
 * In-flight requests are shared, so N concurrent callers for the same key
 * trigger one fetch rather than N — this is what keeps a double-click on the
 * range toggle from issuing two full fan-outs.
 */

interface Entry<T> {
  /** Resolved value, once available. */
  value?: T;
  /** Epoch ms after which `value` is stale. */
  expiresAt: number;
  /** Shared promise while the fetch is in flight. */
  inFlight?: Promise<T>;
}

const store = new Map<string, Entry<unknown>>();

/** Drop expired entries; cheap and only runs when the map grows. */
function prune(now: number): void {
  for (const [key, entry] of store) {
    if (!entry.inFlight && entry.expiresAt <= now) store.delete(key);
  }
}

/**
 * Return the cached value for `key`, or call `fetcher` and cache it for
 * `ttlMs`. A rejected fetch is never cached — the next caller retries.
 */
export async function cached<T>(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const entry = store.get(key) as Entry<T> | undefined;

  if (entry) {
    if (entry.inFlight) return entry.inFlight;
    if (entry.expiresAt > now) return entry.value as T;
  }

  if (store.size > 200) prune(now);

  const inFlight = fetcher()
    .then((value) => {
      store.set(key, { value, expiresAt: Date.now() + ttlMs });
      return value;
    })
    .catch((err) => {
      store.delete(key); // never cache a failure
      throw err;
    });

  store.set(key, { expiresAt: now + ttlMs, inFlight });
  return inFlight;
}

/** Test hook / manual invalidation. */
export function clearCache(): void {
  store.clear();
}
