/** @jest-environment node */
/**
 * embeddingCache — in-memory embedding cache (get/set/has/clear + hit/miss
 * stats). Fake timers are enabled BEFORE the module is required so its hourly
 * cleanup setInterval doesn't leak an open handle into the test run.
 */
jest.useFakeTimers();

// eslint-disable-next-line @typescript-eslint/no-require-imports
const cache = require('@/services/ai/embeddingCache').default as {
  get(t: string): number[] | null;
  set(t: string, e: number[]): void;
  has(t: string): boolean;
  clear(): void;
  clearExpired(): number;
  getStats(): { hits: number; misses: number; size: number };
};

beforeEach(() => cache.clear());
afterAll(() => jest.useRealTimers());

it('returns null on a miss and the stored vector on a hit', () => {
  expect(cache.get('unseen')).toBeNull();
  cache.set('வணக்கம்', [0.1, 0.2, 0.3]);
  expect(cache.get('வணக்கம்')).toEqual([0.1, 0.2, 0.3]);
  expect(cache.has('வணக்கம்')).toBe(true);
});

it('tracks hit/miss stats and size', () => {
  cache.set('a', [1]);
  cache.get('a'); // hit
  cache.get('b'); // miss
  const s = cache.getStats();
  expect(s.hits).toBeGreaterThanOrEqual(1);
  expect(s.misses).toBeGreaterThanOrEqual(1);
  expect(s.size).toBe(1);
});

it('clear() empties the cache', () => {
  cache.set('x', [1, 2]);
  cache.clear();
  expect(cache.get('x')).toBeNull();
  expect(cache.getStats().size).toBe(0);
});

it('clearExpired() removes nothing when entries are fresh', () => {
  cache.set('fresh', [0.5]);
  expect(cache.clearExpired()).toBe(0);
  expect(cache.get('fresh')).toEqual([0.5]);
});
