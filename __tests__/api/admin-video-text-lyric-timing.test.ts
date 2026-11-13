/** @jest-environment node */
/**
 * /api/admin/video-text/[id]/lyric-timing — start the listening worker, report
 * its state from three S3 files, and time the lines from the saved words.
 */
const requireAdminMock = jest.fn();
jest.mock('@/lib/auth-helper', () => ({
  requireAdmin: (...a: unknown[]) => requireAdminMock(...a),
  requireBearer: jest.fn(),
  authErrorResponse: jest.fn((err: unknown) => new Response(String(err), { status: (err as { status?: number }).status ?? 401 })),
}));

const repo = { get: jest.fn() };
jest.mock('@/infrastructure/database/VideoTextRepository', () => ({
  VideoTextRepository: jest.fn().mockImplementation(() => repo),
}));

/** A fake bucket: key → JSON text. */
const store = new Map<string, string>();
const notFound = (name: string) => Object.assign(new Error(name), { name });
jest.mock('@/infrastructure/storage/s3-client', () => ({
  S3Operations: {
    fileExists: jest.fn(async (k: string) => store.has(k)),
    getFile: jest.fn(async (k: string) => {
      if (!store.has(k)) throw notFound('NoSuchKey');
      return { transformToString: async () => store.get(k) };
    }),
    uploadFile: jest.fn(async ({ key, file }: { key: string; file: string }) => {
      store.set(key, file);
      return { key };
    }),
    deleteFile: jest.fn(async (k: string) => store.delete(k)),
  },
}));

const send = jest.fn();
jest.mock('@aws-sdk/client-lambda', () => ({
  LambdaClient: jest.fn().mockImplementation(() => ({ send: (...a: unknown[]) => send(...a) })),
  InvokeCommand: jest.fn().mockImplementation((input: unknown) => ({ input })),
}));
jest.mock('@/lib/aws-config', () => ({ awsConfig: { region: 'ca-central-1', credentials: undefined } }));

import type { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/admin/video-text/[id]/lyric-timing/route';

const ID = 'p1';
const SOURCE = `audio/mastering/video-text/${ID}/source/1794_ab12_song.mp4`;
const BASE = `audio/mastering/lyric-timing/${ID}/1794_ab12_song`;
const ctx = (id = ID) => ({ params: Promise.resolve({ id }) });
const get = () => new Request('http://localhost/x') as unknown as NextRequest;
const post = (body: unknown) =>
  new Request('http://localhost/x', { method: 'POST', body: JSON.stringify(body) }) as unknown as NextRequest;
const project = (source: Record<string, unknown> | null = {}) => ({
  id: ID,
  source: source && { key: SOURCE, durationSec: 60, expiresAt: '2999-01-01T00:00:00.000Z', ...source },
});
const words = {
  durationSec: 60,
  words: [
    { start: 10, end: 11, word: 'one' }, { start: 11, end: 12, word: 'line' },
    { start: 20, end: 21, word: 'two' }, { start: 21, end: 22, word: 'line' },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  store.clear();
  requireAdminMock.mockResolvedValue({ email: 'admin@test' });
  repo.get.mockResolvedValue(project());
  send.mockResolvedValue({ StatusCode: 202 });
});

it('rejects a non-admin', async () => {
  requireAdminMock.mockRejectedValue({ status: 403 });
  expect((await GET(get(), ctx())).status).toBe(403);
  expect((await POST(post({ op: 'start' }), ctx())).status).toBe(403);
  expect(send).not.toHaveBeenCalled();
});

it('needs a project with a live video', async () => {
  expect((await GET(get(), ctx('../x'))).status).toBe(404);
  repo.get.mockResolvedValueOnce(project(null));
  expect((await POST(post({ op: 'start' }), ctx())).status).toBe(400);
  repo.get.mockResolvedValueOnce(project({ expiresAt: '2000-01-01T00:00:00.000Z' }));
  expect((await POST(post({ op: 'start' }), ctx())).status).toBe(410);
  repo.get.mockResolvedValueOnce(project({ key: 'audio/mastering/video-text/other/source/a.mp4' }));
  expect((await POST(post({ op: 'start' }), ctx())).status).toBe(400);
  expect(send).not.toHaveBeenCalled();
});

it('starts the worker once, with keys under its writable prefix, and then reports running', async () => {
  const res = await POST(post({ op: 'start' }), ctx());
  expect(res.status).toBe(202);
  expect(await res.json()).toEqual({ status: 'running', startedAt: expect.any(String) });
  expect(send).toHaveBeenCalledTimes(1);
  const { input } = send.mock.calls[0][0];
  expect(input.FunctionName).toBe('tamilagaval-lyric-timing');
  expect(input.InvocationType).toBe('Event');
  expect(JSON.parse(Buffer.from(input.Payload).toString())).toEqual({
    bucket: 'tamil-web-media', sourceKey: SOURCE, wordsKey: `${BASE}.words.json`, errorKey: `${BASE}.error.json`,
  });
  // A second press while it listens does not start another run.
  expect(await (await POST(post({ op: 'start' }), ctx())).json()).toMatchObject({ status: 'running' });
  expect(send).toHaveBeenCalledTimes(1);
  expect(await (await GET(get(), ctx())).json()).toMatchObject({ status: 'running' });
});

it('says ready once the words exist, without starting the worker again', async () => {
  store.set(`${BASE}.words.json`, JSON.stringify(words));
  expect(await (await GET(get(), ctx())).json()).toEqual({ status: 'ready' });
  expect(await (await POST(post({ op: 'start' }), ctx())).json()).toEqual({ status: 'ready' });
  expect(send).not.toHaveBeenCalled();
});

it('reports a failed run, and a run that never finished, so the page stops waiting', async () => {
  const startedAt = new Date().toISOString();
  store.set(`${BASE}.started.json`, JSON.stringify({ startedAt }));
  store.set(`${BASE}.error.json`, JSON.stringify({ error: 'boom', at: new Date(Date.now() + 1000).toISOString() }));
  expect(await (await GET(get(), ctx())).json()).toEqual({ status: 'error', error: expect.stringMatching(/failed/) });

  store.delete(`${BASE}.error.json`);
  store.set(`${BASE}.started.json`, JSON.stringify({ startedAt: new Date(Date.now() - 17 * 60_000).toISOString() }));
  expect(await (await GET(get(), ctx())).json()).toEqual({ status: 'error', error: expect.stringMatching(/too long/) });
  // Pressing again after either starts a fresh run.
  expect((await POST(post({ op: 'start' }), ctx())).status).toBe(202);
  expect(send).toHaveBeenCalledTimes(1);
});

it('releases the run when the worker cannot be started', async () => {
  send.mockRejectedValueOnce(new Error('AccessDenied'));
  const res = await POST(post({ op: 'start' }), ctx());
  expect(res.status).toBe(502);
  expect(store.has(`${BASE}.started.json`)).toBe(false);
});

it('times the lines from the saved words, keeping the text exactly', async () => {
  store.set(`${BASE}.words.json`, JSON.stringify(words));
  const res = await POST(post({ op: 'align', lyricsText: 'one line\ntwo line' }), ctx());
  expect(res.status).toBe(200);
  const { lines } = await res.json();
  expect(lines.map((l: { text: string }) => l.text)).toEqual(['one line', 'two line']);
  expect(lines[0].startSec).toBeCloseTo(10, 0);
  expect(send).not.toHaveBeenCalled();
});

it('asks for a listen first, and explains an unusable result', async () => {
  expect((await POST(post({ op: 'align', lyricsText: 'a' }), ctx())).status).toBe(409);
  store.set(`${BASE}.words.json`, JSON.stringify({ durationSec: 60, words: [] }));
  const res = await POST(post({ op: 'align', lyricsText: 'a' }), ctx());
  expect(res.status).toBe(422);
  expect((await res.json()).error).toMatch(/No singing was heard/);
});

it('refuses a malformed request', async () => {
  expect((await POST(post({ op: 'nope' }), ctx())).status).toBe(400);
});
