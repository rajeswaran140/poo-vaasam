/** @jest-environment jsdom */
/** useAutosave: a late PATCH response never rolls the version back. */
jest.mock('@/lib/client-auth', () => ({ adminFetch: jest.fn() }));

import { act, renderHook } from '@testing-library/react';
import { adminFetch } from '@/lib/client-auth';
import { useAutosave } from '@/components/admin/video-text/useAutosave';
import type { VideoTextProject } from '@/types/videoText';

const mockedFetch = adminFetch as jest.Mock;
const json = (body: unknown, status = 200) =>
  ({ ok: status < 400, status, json: async () => body }) as unknown as Response;
const base: VideoTextProject = {
  id: 'p1', name: 'Song', titleText: '', creditsText: '', lyricsText: '', blocks: [],
  style: { sizeScale: 1, lyricPosition: 'lower' }, source: null,
  render: { renderId: null, status: 'idle', progress: null, outputKey: null, outputExpiresAt: null, error: null, startedAt: null, updatedAt: null },
  version: 3, createdAt: '', updatedAt: '',
};

beforeEach(() => {
  jest.useFakeTimers();
  mockedFetch.mockReset();
});
afterEach(() => jest.useRealTimers());

it('keeps a newer version when an older PATCH answers late', async () => {
  let release!: (r: Response) => void;
  mockedFetch.mockImplementationOnce(() => new Promise<Response>((r) => { release = r; }));
  mockedFetch.mockImplementation(async () => json({ version: 10 }));
  const onVersion = jest.fn();
  const { rerender } = renderHook(({ p }) => useAutosave(p, onVersion), { initialProps: { p: base } });

  rerender({ p: { ...base, titleText: 'A' } });
  await act(async () => { jest.advanceTimersByTime(800); });
  expect(mockedFetch).toHaveBeenCalledTimes(1);

  // Meanwhile a re-upload bumped the project to 9.
  rerender({ p: { ...base, titleText: 'A', version: 9 } });
  await act(async () => { release(json({ version: 4 })); });
  expect(onVersion).not.toHaveBeenCalledWith(4);

  rerender({ p: { ...base, titleText: 'AB', version: 9 } });
  await act(async () => { jest.advanceTimersByTime(800); });
  expect(JSON.parse(String(mockedFetch.mock.calls[1][1].body)).version).toBe(9);
});
