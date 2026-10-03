/** @jest-environment node */
// __tests__/api/admin-stems-remix.test.ts
jest.mock('@/lib/auth-helper', () => ({
  requireAdmin: jest.fn().mockResolvedValue({}), requireBearer: jest.fn(),
  authErrorResponse: jest.fn(() => new Response('no', { status: 401 })),
}));
const masterGet = jest.fn();
jest.mock('@/infrastructure/database/MasterJobRepository', () => ({
  MasterJobRepository: jest.fn().mockImplementation(() => ({ get: masterGet })),
}));
const setGet = jest.fn(); const saveMix = jest.fn(); const markRemixRequested = jest.fn();
jest.mock('@/infrastructure/database/StemSetRepository', () => ({
  StemSetRepository: jest.fn().mockImplementation(() => ({ get: setGet, saveMix, markRemixRequested })),
}));
const lambdaSend = jest.fn().mockResolvedValue({});
jest.mock('@aws-sdk/client-lambda', () => ({
  LambdaClient: jest.fn().mockImplementation(() => ({ send: lambdaSend })),
  InvokeCommand: jest.fn((args: unknown) => ({ args })),
}));
jest.mock('@/lib/aws-config', () => ({ awsConfig: { region: 'ca-central-1', credentials: undefined } }));

import { PUT } from '@/app/api/admin/stems/[masterJobId]/mix/route';
import { POST as REMIX } from '@/app/api/admin/stems/[masterJobId]/remix/route';
import { requireAdmin } from '@/lib/auth-helper';
import type { StemSet } from '@/types/stemSet';

const JOB = '0b5e2c1a-1111-4222-8333-444455556666';
const SAVED = { id: JOB, status: 'done', savedAt: '2026-10-01T00:00:00.000Z', title: 'பாடல்', target: -14 };

const req = (method: string, body?: unknown) =>
  new Request('http://x', { method, ...(body ? { body: JSON.stringify(body) } : {}) }) as never;
const p = (extra: Record<string, string> = {}) => ({ params: Promise.resolve({ masterJobId: JOB, ...extra }) });

// Same shape as the stem() helper in __tests__/lib/stems.test.ts (Task 9).
const stem = (id: string, over: Record<string, unknown> = {}) => ({
  key: `audio/mastering/stems/${JOB}/${id}.wav`, name: id, previewKey: 'p', previewError: null,
  previewRequestedAt: null, durationSec: 200, sampleRate: 48000, channels: 2, ...over,
});
const SET_WITH = (ids: string[]): StemSet => {
  const stems: Record<string, ReturnType<typeof stem>> = {};
  for (const id of ids) stems[id] = stem(id);
  return { masterJobId: JOB, order: ids, stems, mix: {}, remix: null, createdAt: 't', updatedAt: 't' };
};

beforeEach(() => {
  jest.clearAllMocks();
  masterGet.mockResolvedValue(SAVED);
  setGet.mockResolvedValue(null);
  saveMix.mockResolvedValue(undefined);
  markRemixRequested.mockResolvedValue(undefined);
});

describe('PUT /mix', () => {
  it('is admin-only', async () => {
    (requireAdmin as jest.Mock).mockRejectedValueOnce(new Error('no'));
    expect((await PUT(req('PUT', { mix: {} }), p())).status).toBe(401);
  });

  it('404s an unknown or unsaved master', async () => {
    masterGet.mockResolvedValueOnce(null);
    expect((await PUT(req('PUT', { mix: {} }), p())).status).toBe(404);
  });

  it('saves a mix, clamped to the fader range, only for stems in the set', async () => {
    setGet.mockResolvedValue(SET_WITH(['a', 'b']));
    const res = await PUT(req('PUT', { mix: { a: { gainDb: -3, muted: false }, b: { gainDb: 0, muted: true }, ghost: { gainDb: 0, muted: false } } }), p());
    expect(res.status).toBe(200);
    expect(saveMix).toHaveBeenCalledWith(JOB, { a: { gainDb: -3, muted: false }, b: { gainDb: 0, muted: true } });
  });

  it('clamps a level outside the fader range before saving', async () => {
    setGet.mockResolvedValue(SET_WITH(['a']));
    const res = await PUT(req('PUT', { mix: { a: { gainDb: 999, muted: false } } }), p());
    expect(res.status).toBe(200);
    expect(saveMix).toHaveBeenCalledWith(JOB, { a: { gainDb: 6, muted: false } });
  });

  it('refuses a level that is not a number', async () => {
    const res = await PUT(req('PUT', { mix: { a: { gainDb: 'loud', muted: false } } }), p());
    expect(res.status).toBe(400);
    expect(saveMix).not.toHaveBeenCalled();
  });

  it('refuses a body with no mix field', async () => {
    const res = await PUT(req('PUT', {}), p());
    expect(res.status).toBe(400);
  });

  it('refuses to save when the master has no stem set at all, rather than creating a bare one', async () => {
    setGet.mockResolvedValue(null);
    const res = await PUT(req('PUT', { mix: { a: { gainDb: 0, muted: false } } }), p());
    expect(res.status).toBe(409);
    expect(saveMix).not.toHaveBeenCalled();
  });
});

describe('POST /remix', () => {
  it('is admin-only', async () => {
    (requireAdmin as jest.Mock).mockRejectedValueOnce(new Error('no'));
    expect((await REMIX(req('POST'), p())).status).toBe(401);
  });

  it('404s an unknown or unsaved master', async () => {
    masterGet.mockResolvedValueOnce(null);
    expect((await REMIX(req('POST'), p())).status).toBe(404);
    expect(lambdaSend).not.toHaveBeenCalled();
  });

  it('queues a remix from the STORED mix — the request carries no levels', async () => {
    setGet.mockResolvedValue(SET_WITH(['a']));
    const res = await REMIX(req('POST', { mix: { a: { gainDb: 6, muted: false } } }), p());
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ success: true, status: 'queued' });
    expect(markRemixRequested).toHaveBeenCalledWith(JOB);
    const payload = JSON.parse(lambdaSend.mock.calls[0][0].args.Payload.toString());
    expect(payload).toEqual({ stemMix: { masterJobId: JOB } });
  });

  it('refuses a remix with every stem muted, in the planner\'s words', async () => {
    setGet.mockResolvedValue({ ...SET_WITH(['a']), mix: { a: { gainDb: 0, muted: true } } });
    const res = await REMIX(req('POST'), p());
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('Every stem is muted') });
    expect(lambdaSend).not.toHaveBeenCalled();
    expect(markRemixRequested).not.toHaveBeenCalled();
  });

  it('refuses a remix when the master has no stem set at all', async () => {
    setGet.mockResolvedValue(null);
    const res = await REMIX(req('POST'), p());
    expect(res.status).toBe(409);
    expect(lambdaSend).not.toHaveBeenCalled();
  });

  it('502s when the worker invoke throws', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    setGet.mockResolvedValue(SET_WITH(['a']));
    lambdaSend.mockRejectedValueOnce(new Error('throttled'));
    const res = await REMIX(req('POST'), p());
    expect(res.status).toBe(502);
    errSpy.mockRestore();
  });
});
