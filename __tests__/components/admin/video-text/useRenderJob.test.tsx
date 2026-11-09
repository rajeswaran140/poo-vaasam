/** @jest-environment jsdom */
/**
 * useRenderJob's double-click guard is a ref, not state: two start() calls in
 * the same tick (before any re-render could disable the button) must still
 * produce one overlays POST and one render POST.
 */
jest.mock('@/lib/client-auth', () => ({ adminFetch: jest.fn() }));
jest.mock('@/lib/mastering-upload-client', () => ({ putToS3: jest.fn() }));
jest.mock('@/lib/video-text/draw', () => ({ ensureFonts: jest.fn(), renderBlockPng: jest.fn() }));
jest.mock('@/lib/video-text/logo', () => ({ ...jest.requireActual('@/lib/video-text/logo'), renderLogoPng: jest.fn() }));

import { act, renderHook, waitFor } from '@testing-library/react';
import { adminFetch } from '@/lib/client-auth';
import { putToS3 } from '@/lib/mastering-upload-client';
import { ensureFonts, renderBlockPng } from '@/lib/video-text/draw';
import { useRenderJob } from '@/components/admin/video-text/useRenderJob';
import { renderLogoPng } from '@/lib/video-text/logo';
import type { RenderState } from '@/types/videoText';

const mockedFetch = adminFetch as jest.Mock;
const json = (body: unknown, status = 200) =>
  ({ ok: status < 400, status, json: async () => body }) as unknown as Response;
const idle: RenderState = {
  renderId: null, status: 'idle', progress: null, outputKey: null,
  outputExpiresAt: null, error: null, startedAt: null, updatedAt: null,
};
const snapshot = {
  blocks: [{ id: 'title', track: 'title' as const, text: 'Song', startSec: 0, endSec: 5 }],
  frame: { width: 1920, height: 1080 },
  style: { sizeScale: 1, lyricPosition: 'lower' as const },
  version: 7,
};
const input = { prepare: async () => snapshot };

beforeEach(() => {
  jest.clearAllMocks();
  (ensureFonts as jest.Mock).mockResolvedValue(undefined);
  (renderBlockPng as jest.Mock).mockResolvedValue(new Blob(['png'], { type: 'image/png' }));
  (putToS3 as jest.Mock).mockResolvedValue(undefined);
  let renderId: string | undefined;
  mockedFetch.mockImplementation(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (method === 'POST' && url.endsWith('/overlays')) {
      return json({ uploads: [{ blockId: 'title', url: 'https://s3', fields: {}, key: 'k' }] });
    }
    if (method === 'POST' && url.endsWith('/render')) {
      renderId = JSON.parse(String(init?.body)).renderId;
      return json({ status: 'queued' }, 202);
    }
    if (method === 'GET') return json({ project: { render: { ...idle, renderId, status: 'done', outputKey: 'k' } } });
    throw new Error(`unexpected ${method} ${url}`);
  });
});

it('two start() calls in one tick run one render', async () => {
  const { result } = renderHook(() => useRenderJob('p1', idle));
  await act(async () => {
    void result.current.start(input);
    void result.current.start(input);
  });
  await waitFor(() => expect(result.current.render.status).toBe('done'));
  const posts = (suffix: string) =>
    mockedFetch.mock.calls.filter(([u, i]) => i?.method === 'POST' && String(u).endsWith(suffix));
  expect(posts('/overlays')).toHaveLength(1);
  expect(posts('/render')).toHaveLength(1);
  expect(renderBlockPng).toHaveBeenCalledTimes(1);
  // The fonts the parts use are loaded first, from the same style the PNGs use.
  expect(ensureFonts).toHaveBeenCalledWith(expect.objectContaining({ sizeScale: 1 }));
  // F10: the render is claimed for the version the PNGs were drawn from.
  expect(JSON.parse(String(posts('/render')[0][1].body)).version).toBe(7);
});

it('a render still "in flight" but silent past the stale time shows the stopped message, not nothing', () => {
  const old = new Date(Date.now() - 21 * 60 * 1000).toISOString();
  const { result } = renderHook(() =>
    useRenderJob('p1', { ...idle, renderId: 'r0', status: 'encoding', startedAt: old, updatedAt: old }),
  );
  expect(result.current.running).toBe(false);
  expect(result.current.error).toBe('The render stopped responding — press Make video to try again.');
  expect(mockedFetch).not.toHaveBeenCalled();
});

it('with the logo shown: draws its PNG at the frame size and uploads it as one more overlay', async () => {
  const logoBlob = new Blob(['logo'], { type: 'image/png' });
  (renderLogoPng as jest.Mock).mockResolvedValue(logoBlob);
  mockedFetch.mockImplementation(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (method === 'POST' && url.endsWith('/overlays')) {
      return json({ uploads: [
        { blockId: 'title', url: 'https://s3', fields: {}, key: 'k1' },
        { blockId: '_logo', url: 'https://s3', fields: {}, key: 'k2' },
      ] });
    }
    if (method === 'POST' && url.endsWith('/render')) return json({ status: 'queued' }, 202);
    return json({ project: { render: { ...idle, status: 'done', outputKey: 'k' } } });
  });
  const image = { width: 400, height: 400 } as unknown as CanvasImageSource & { width: number; height: number };
  const logo = { image, width: 400, height: 400, key: 'logo-key' };
  const style = { ...snapshot.style, logo: { show: true, corner: 'top-left' as const } };
  const { result } = renderHook(() => useRenderJob('p1', idle));
  await act(async () => {
    void result.current.start({ prepare: async () => ({ ...snapshot, style, logo }) });
  });
  await waitFor(() => expect(putToS3).toHaveBeenCalledTimes(2));
  expect(renderLogoPng).toHaveBeenCalledWith(image, snapshot.frame, expect.objectContaining({ show: true, corner: 'top-left' }));
  const overlays = mockedFetch.mock.calls.find(([u, i]) => i?.method === 'POST' && String(u).endsWith('/overlays'))!;
  expect(JSON.parse(String(overlays[1].body)).blockIds).toEqual(['title', '_logo']);
  const files = (putToS3 as jest.Mock).mock.calls.map((c) => c[2] as File);
  expect(files.map((f) => f.name)).toEqual(['title.png', '_logo.png']);
});

it('without the logo: no logo PNG and no logo overlay', async () => {
  const { result } = renderHook(() => useRenderJob('p1', idle));
  await act(async () => {
    void result.current.start(input);
  });
  await waitFor(() => expect(result.current.render.status).toBe('done'));
  expect(renderLogoPng).not.toHaveBeenCalled();
  const overlays = mockedFetch.mock.calls.find(([u, i]) => i?.method === 'POST' && String(u).endsWith('/overlays'))!;
  expect(JSON.parse(String(overlays[1].body)).blockIds).toEqual(['title']);
});
