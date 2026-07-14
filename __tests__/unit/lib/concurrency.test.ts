/** @jest-environment node */
import { mapWithConcurrency } from '@/lib/concurrency';

const defer = <T,>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe('mapWithConcurrency', () => {
  it('maps every item and preserves input order', async () => {
    const out = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => n * 10);
    expect(out).toEqual([10, 20, 30, 40, 50]);
  });

  it('returns [] for an empty input without running anything', async () => {
    const fn = jest.fn();
    expect(await mapWithConcurrency([], 4, fn)).toEqual([]);
    expect(fn).not.toHaveBeenCalled();
  });

  it('never exceeds the concurrency limit', async () => {
    let inFlight = 0;
    let peak = 0;
    const out = await mapWithConcurrency(Array.from({ length: 20 }, (_, i) => i), 3, async (i) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight--;
      return i;
    });
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1); // actually parallel, not serial
    expect(out).toHaveLength(20);
  });

  it('actually overlaps work (a slow item does not block the next worker)', async () => {
    const slow = defer<string>();
    const started: number[] = [];
    const run = mapWithConcurrency([0, 1], 2, async (i) => {
      started.push(i);
      if (i === 0) return slow.promise;
      return 'fast';
    });
    await Promise.resolve();
    expect(started).toEqual([0, 1]); // item 1 started while item 0 is still pending
    slow.resolve('slow');
    expect(await run).toEqual(['slow', 'fast']);
  });

  it('resolves a throwing task to undefined without sinking the batch', async () => {
    const out = await mapWithConcurrency([1, 2, 3], 2, async (n) => {
      if (n === 2) throw new Error('upstream 429');
      return n;
    });
    expect(out).toEqual([1, undefined, 3]);
  });

  it('clamps a nonsense limit to at least 1 rather than hanging', async () => {
    expect(await mapWithConcurrency([1, 2], 0, async (n) => n)).toEqual([1, 2]);
    expect(await mapWithConcurrency([1, 2], -5, async (n) => n)).toEqual([1, 2]);
    expect(await mapWithConcurrency([1, 2], NaN, async (n) => n)).toEqual([1, 2]);
  });

  it('handles a limit larger than the item count', async () => {
    expect(await mapWithConcurrency([1, 2], 100, async (n) => n * 2)).toEqual([2, 4]);
  });
});
