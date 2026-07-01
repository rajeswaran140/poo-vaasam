/** @jest-environment jsdom */
/**
 * UNIT TESTS — useVideoAnalysis hook (shared by the retention + geography
 * panels). Covers the happy path, clear-on-video-change, and the out-of-order
 * request guard.
 */
import { renderHook, act } from '@testing-library/react';
import { useVideoAnalysis } from '@/components/admin/useVideoAnalysis';
import { adminFetch } from '@/lib/client-auth';

jest.mock('@/lib/client-auth', () => ({ adminFetch: jest.fn() }));
const adminFetchMock = adminFetch as jest.Mock;

const videos = [{ id: 'vA' }, { id: 'vB' }];
const buildUrl = (id: string) => `/api/x?videoId=${id}`;

beforeEach(() => adminFetchMock.mockReset());

it('stores the result and calls the built URL on a successful analyze', async () => {
  adminFetchMock.mockResolvedValue({ ok: true, json: async () => ({ success: true, value: 1 }) });
  const { result } = renderHook(() => useVideoAnalysis<{ value: number }>(videos, buildUrl));
  await act(async () => {
    await result.current.analyze();
  });
  expect(adminFetchMock).toHaveBeenCalledWith('/api/x?videoId=vA');
  expect(result.current.result).toEqual({ success: true, value: 1 });
  expect(result.current.error).toBeNull();
});

it('clears the previous result and error when the video changes', async () => {
  adminFetchMock.mockResolvedValue({ ok: true, json: async () => ({ success: true, value: 1 }) });
  const { result } = renderHook(() => useVideoAnalysis(videos, buildUrl));
  await act(async () => {
    await result.current.analyze();
  });
  expect(result.current.result).not.toBeNull();
  act(() => {
    result.current.setVideoId('vB');
  });
  expect(result.current.videoId).toBe('vB');
  expect(result.current.result).toBeNull();
  expect(result.current.error).toBeNull();
});

it('ignores a superseded (out-of-order) response', async () => {
  let resolveStale!: (v: unknown) => void;
  const stalePromise = new Promise((r) => {
    resolveStale = r;
  });
  adminFetchMock
    .mockReturnValueOnce({ ok: true, json: () => stalePromise }) // call 1: hangs at res.json()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true, value: 'fresh' }) }); // call 2

  const { result } = renderHook(() => useVideoAnalysis<{ value: string }>(videos, buildUrl));

  let stalePending!: Promise<void>;
  await act(async () => {
    stalePending = result.current.analyze(); // start call 1 (pending)
    await result.current.analyze(); // call 2 resolves → 'fresh'
  });
  expect(result.current.result).toEqual({ success: true, value: 'fresh' });

  // Now let the earlier request finish LATE with stale data — it must be dropped.
  await act(async () => {
    resolveStale({ success: true, value: 'stale' });
    await stalePending;
  });
  expect(result.current.result).toEqual({ success: true, value: 'fresh' });
});
