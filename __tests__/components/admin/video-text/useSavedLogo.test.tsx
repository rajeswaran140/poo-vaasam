/** @jest-environment jsdom */
jest.mock('@/lib/client-auth', () => ({ adminFetch: jest.fn() }));
jest.mock('@/lib/mastering-upload-client', () => ({ putToS3: jest.fn() }));

import { act, renderHook, waitFor } from '@testing-library/react';
import { adminFetch } from '@/lib/client-auth';
import { putToS3 } from '@/lib/mastering-upload-client';
import { logoFileProblem, useSavedLogo } from '@/components/admin/video-text/useSavedLogo';

const mockedFetch = adminFetch as jest.Mock;
const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as unknown as Response;
const SAVED = { key: 'k.png', contentType: 'image/png', width: 64, height: 32, uploadedAt: 'x', url: 'https://s3/k' };

beforeEach(() => {
  jest.clearAllMocks();
  (globalThis as { createImageBitmap?: unknown }).createImageBitmap = jest.fn(async () => ({ width: 64, height: 32 }));
  (globalThis as { fetch?: unknown }).fetch = jest.fn(async () => ({ ok: true, blob: async () => new Blob(['img']) }));
  (putToS3 as jest.Mock).mockResolvedValue(undefined);
});

it('loads none, or the saved logo decoded from a fetched blob', async () => {
  mockedFetch.mockResolvedValueOnce(json({ logo: null }));
  const a = renderHook(() => useSavedLogo());
  await waitFor(() => expect(a.result.current.state.kind).toBe('none'));
  mockedFetch.mockResolvedValueOnce(json({ logo: SAVED }));
  const b = renderHook(() => useSavedLogo());
  await waitFor(() => expect(b.result.current.state.kind).toBe('ready'));
  expect(fetch).toHaveBeenCalledWith('https://s3/k');
  const s = b.result.current.state;
  expect(s.kind === 'ready' && s.image).toMatchObject({ width: 64, height: 32, key: 'k.png' });
});

it('a failed load says so instead of hanging', async () => {
  mockedFetch.mockResolvedValueOnce(json({ error: 'x' }, 502));
  const { result } = renderHook(() => useSavedLogo());
  await waitFor(() => expect(result.current.state.kind).toBe('error'));
});

it('upload: presign → S3 → save with the decoded size; the new logo is ready', async () => {
  mockedFetch.mockImplementation(async (_url: string, init?: RequestInit) => {
    if (!init?.method) return json({ logo: null });
    if (init.method === 'POST') return json({ key: 'new.png', url: 'https://s3', fields: { a: 'b' } });
    return json({ logo: { ...SAVED, key: 'new.png' } });
  });
  const { result } = renderHook(() => useSavedLogo());
  await waitFor(() => expect(result.current.state.kind).toBe('none'));
  const file = new File(['png'], 'logo.png', { type: 'image/png' });
  await act(() => result.current.upload(file));
  expect(putToS3).toHaveBeenCalledWith('https://s3', { a: 'b' }, file, expect.any(Function), expect.anything());
  const put = mockedFetch.mock.calls.find(([, i]) => i?.method === 'PUT')!;
  expect(JSON.parse(String(put[1].body))).toEqual({ key: 'new.png', width: 64, height: 32 });
  expect(result.current.state.kind).toBe('ready');
  expect(result.current.uploadError).toBeNull();
});

it('refuses a wrong type or an oversize file before uploading', async () => {
  expect(logoFileProblem(new File(['x'], 'a.svg', { type: 'image/svg+xml' }))).toMatch(/PNG, JPG or WebP/);
  expect(logoFileProblem(new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'a.png', { type: 'image/png' }))).toMatch(/5 MB/);
  mockedFetch.mockResolvedValue(json({ logo: null }));
  const { result } = renderHook(() => useSavedLogo());
  await act(() => result.current.upload(new File(['x'], 'a.gif', { type: 'image/gif' })));
  expect(result.current.uploadError).toMatch(/PNG, JPG or WebP/);
  expect(putToS3).not.toHaveBeenCalled();
});
