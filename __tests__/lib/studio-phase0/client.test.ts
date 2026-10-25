/** @jest-environment jsdom */
jest.mock('@/lib/client-auth', () => ({ adminFetch: jest.fn() }));
import { workerProbe } from '@/lib/studio-phase0/client';

beforeAll(() => {
  // jsdom has no createObjectURL.
  URL.createObjectURL = jest.fn(() => 'blob:x');
  URL.revokeObjectURL = jest.fn();
});

describe('workerProbe', () => {
  it('resolves false when new Worker throws (a CSP block)', async () => {
    (window as unknown as { Worker: unknown }).Worker = jest.fn(() => {
      throw new DOMException('Refused to create a worker', 'SecurityError');
    });
    await expect(workerProbe()).resolves.toBe(false);
  });

  it('resolves false on an error event', async () => {
    (window as unknown as { Worker: unknown }).Worker = jest.fn(function (this: Record<string, unknown>) {
      setTimeout(() => (this.onerror as () => void)?.(), 0);
      this.terminate = jest.fn();
    });
    await expect(workerProbe()).resolves.toBe(false);
  });

  it('resolves true when the worker posts back', async () => {
    (window as unknown as { Worker: unknown }).Worker = jest.fn(function (this: Record<string, unknown>) {
      setTimeout(() => (this.onmessage as () => void)?.(), 0);
      this.terminate = jest.fn();
    });
    await expect(workerProbe()).resolves.toBe(true);
  });

  it('resolves false when nothing comes back within a second', async () => {
    jest.useFakeTimers();
    (window as unknown as { Worker: unknown }).Worker = jest.fn(function (this: Record<string, unknown>) {
      this.terminate = jest.fn();
    });
    const p = workerProbe();
    jest.advanceTimersByTime(1001);
    await expect(p).resolves.toBe(false);
    jest.useRealTimers();
  });
});
