/** @jest-environment node */
/**
 * /api/admin/visual-story/[vsId]/lyric-timing — listen to the STORY's own song
 * (its master audio) and time pasted lines, in window time (design 2026-11-13 §4).
 */
const requireAdminMock = jest.fn();
jest.mock('@/lib/auth-helper', () => ({
  requireAdmin: (...a: unknown[]) => requireAdminMock(...a),
  requireBearer: jest.fn((req: Request) => {
    if (!req.headers.get('authorization')) throw Object.assign(new Error('no bearer'), { status: 401 });
  }),
  authErrorResponse: jest.fn((err: unknown) => new Response(String(err), { status: (err as { status?: number }).status ?? 401 })),
}));

const repo = { findById: jest.fn() };
jest.mock('@/infrastructure/database/VisualStoryRepository', () => ({
  VisualStoryRepository: jest.fn().mockImplementation(() => repo),
}));

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
jest.mock('@/lib/aws-config', () => ({ ...jest.requireActual('@/lib/aws-config'), awsConfig: { region: 'ca-central-1', credentials: undefined } }));

import type { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/admin/visual-story/[vsId]/lyric-timing/route';
import { __resetVisualStoryRateLimitForTests } from '@/lib/visual-story-rate-limit';

const VS = 'vs_1700000000000_abcdef12';
const AUDIO = 'audio/mastering/1794515624099_43c4bc51_-_Nee-5_13_master-14LUFS.wav';
const BASE = `audio/mastering/lyric-timing/vs/${VS}/1794515624099_43c4bc51_-_Nee-5_13_master-14LUFS`;
const ctx = (vsId = VS) => ({ params: Promise.resolve({ vsId }) });
const get = () => new Request('http://localhost/x') as unknown as NextRequest;
const post = (body: unknown, bearer = true) =>
  new Request('http://localhost/x', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: bearer ? { authorization: 'Bearer t' } : {},
  }) as unknown as NextRequest;
const story = { vsId: VS, audioKey: AUDIO, windowStartSec: 5, windowEndSec: 60 };
const words = {
  durationSec: 200,
  words: [
    { start: 10, end: 11, word: 'one' }, { start: 11, end: 12, word: 'line' },
    { start: 20, end: 21, word: 'two' }, { start: 21, end: 22, word: 'line' },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  store.clear();
  __resetVisualStoryRateLimitForTests();
  requireAdminMock.mockResolvedValue({ email: 'admin@test' });
  repo.findById.mockResolvedValue(story);
  send.mockResolvedValue({ StatusCode: 202 });
});

it('starts the worker once on the story\'s own song, then reports running', async () => {
  const res = await POST(post({ op: 'start' }), ctx());
  expect(res.status).toBe(202);
  expect(send).toHaveBeenCalledTimes(1);
  const { input } = send.mock.calls[0][0] as { input: { FunctionName: string; Payload: Uint8Array } };
  expect(input.FunctionName).toBe('tamilagaval-lyric-timing');
  expect(JSON.parse(Buffer.from(input.Payload).toString())).toEqual({
    bucket: 'tamil-web-media',
    sourceKey: AUDIO,
    wordsKey: `${BASE}.words.json`,
    errorKey: `${BASE}.error.json`,
  });
  expect(await (await POST(post({ op: 'start' }), ctx())).json()).toEqual({ status: 'running', startedAt: expect.any(String) });
  expect(send).toHaveBeenCalledTimes(1);
  expect(await (await GET(get(), ctx())).json()).toEqual({ status: 'running', startedAt: expect.any(String) });
});

it('asks for a listen first when there are no words yet', async () => {
  const res = await POST(post({ op: 'align', lyricsText: 'one line\ntwo line' }), ctx());
  expect(res.status).toBe(409);
  expect((await res.json()).error).toBe('Press Listen to the song first.');
});

it('times the lines in window time, keeping the text exactly', async () => {
  store.set(`${BASE}.words.json`, JSON.stringify(words));
  const res = await POST(post({ op: 'align', lyricsText: 'one line\ntwo line' }), ctx());
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.lines.map((l: { text: string }) => l.text)).toEqual(['one line', 'two line']);
  expect(body.lines[0].startSec).toBeCloseTo(5, 1);
  expect(body.lines[1].startSec).toBeCloseTo(15, 1);
  expect(body).toMatchObject({ heard: 2, total: 2 });
});

it('explains a result it cannot use', async () => {
  store.set(`${BASE}.words.json`, JSON.stringify({ durationSec: 200, words: [] }));
  const res = await POST(post({ op: 'align', lyricsText: 'one line' }), ctx());
  expect(res.status).toBe(422);
  expect((await res.json()).error).toMatch(/No singing was heard/);
});

it('404s an unknown or malformed story, and needs a bearer token', async () => {
  expect((await GET(get(), ctx('../x'))).status).toBe(404);
  repo.findById.mockResolvedValueOnce(null);
  expect((await POST(post({ op: 'start' }), ctx())).status).toBe(404);
  expect((await POST(post({ op: 'start' }, false), ctx())).status).toBe(401);
  expect(send).not.toHaveBeenCalled();
});

it('times whole-song lyrics for a story that covers only part of the song (review 2026-11-13)', async () => {
  // The window ends at 60 s; the song runs 200 s and its last lines are sung long after.
  const late = [150, 160, 170, 180, 190].flatMap((t, i) => [
    { start: t, end: t + 1, word: `late${i}` }, { start: t + 1, end: t + 2, word: 'line' },
  ]);
  store.set(`${BASE}.words.json`, JSON.stringify({ ...words, words: [...words.words, ...late] }));
  const lyrics = ['one line', 'two line', ...[0, 1, 2, 3, 4].map((i) => `late${i} line`)].join('\n');
  const res = await POST(post({ op: 'align', lyricsText: lyrics }), ctx());
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.lines.map((l: { text: string }) => l.text)).toEqual(['one line', 'two line']);
});
