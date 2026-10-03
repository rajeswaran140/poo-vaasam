/** @jest-environment node */
// __tests__/api/admin-stems.test.ts
jest.mock('@/lib/auth-helper', () => ({
  requireAdmin: jest.fn().mockResolvedValue({}), requireBearer: jest.fn(),
  authErrorResponse: jest.fn(() => new Response('no', { status: 401 })),
}));
const masterGet = jest.fn();
jest.mock('@/infrastructure/database/MasterJobRepository', () => ({
  MasterJobRepository: jest.fn().mockImplementation(() => ({ get: masterGet })),
}));
const setGet = jest.fn(); const addStem = jest.fn(); const renameStem = jest.fn(); const removeStem = jest.fn();
const setPreviewError = jest.fn(); const markPreviewRequested = jest.fn();
jest.mock('@/infrastructure/database/StemSetRepository', () => ({
  StemSetRepository: jest.fn().mockImplementation(() => ({
    get: setGet, addStem, renameStem, removeStem, setPreviewError, markPreviewRequested,
  })),
}));
const lambdaSend = jest.fn().mockResolvedValue({});
jest.mock('@aws-sdk/client-lambda', () => ({
  LambdaClient: jest.fn().mockImplementation(() => ({ send: lambdaSend })),
  InvokeCommand: jest.fn((args: unknown) => ({ args })),
}));
jest.mock('@/lib/aws-config', () => ({ awsConfig: { region: 'ca-central-1', credentials: undefined } }));

import { GET } from '@/app/api/admin/stems/[masterJobId]/route';
import { POST } from '@/app/api/admin/stems/[masterJobId]/stems/route';
import { PATCH, DELETE } from '@/app/api/admin/stems/[masterJobId]/stems/[stemId]/route';
import { requireAdmin } from '@/lib/auth-helper';

const JOB = '0b5e2c1a-1111-4222-8333-444455556666';
const KEY = `audio/mastering/stems/${JOB}/1696000000000_ab12cd34_2_Drums.wav`;
const SAVED = { id: JOB, status: 'done', savedAt: '2026-10-01T00:00:00.000Z', title: 'பாடல்', target: -14 };
const req = (method: string, body?: unknown) =>
  new Request('http://x', { method, ...(body ? { body: JSON.stringify(body) } : {}) }) as never;
const p = (extra: Record<string, string> = {}) => ({ params: Promise.resolve({ masterJobId: JOB, ...extra }) });

const SID = '1696000000000_ab12cd34_2_Drums';

beforeEach(() => {
  jest.clearAllMocks();
  masterGet.mockResolvedValue(SAVED);
  setGet.mockResolvedValue(null);
  addStem.mockResolvedValue({
    masterJobId: JOB, order: [SID],
    stems: { [SID]: { key: KEY, name: 'Drums', previewKey: null, previewError: null } },
    mix: {}, remix: null,
  });
  setPreviewError.mockResolvedValue(undefined);
  markPreviewRequested.mockResolvedValue(undefined);
});

it('is admin-only, everywhere', async () => {
  (requireAdmin as jest.Mock).mockRejectedValueOnce(new Error('no'));
  expect((await GET(req('GET'), p())).status).toBe(401);
});

it('reads a master\'s set, null when it has none yet', async () => {
  const res = await GET(req('GET'), p());
  expect(await res.json()).toMatchObject({ success: true, set: null, master: { id: JOB, title: 'பாடல்', target: -14 } });
});

it('404s an unknown or unsaved master', async () => {
  masterGet.mockResolvedValueOnce(null);
  expect((await GET(req('GET'), p())).status).toBe(404);
  masterGet.mockResolvedValueOnce({ ...SAVED, savedAt: null });
  expect((await POST(req('POST', { key: KEY, filename: '2_Drums.wav' }), p())).status).toBe(404);
});

it('adds a stem from its own folder and asks the worker for a listening copy', async () => {
  const res = await POST(req('POST', { key: KEY, filename: '2_Drums.wav' }), p());
  expect(res.status).toBe(201);
  expect(addStem).toHaveBeenCalledWith(JOB, KEY, '2_Drums.wav');
  const payload = JSON.parse((lambdaSend.mock.calls[0][0] as { args: { Payload: Buffer } }).args.Payload.toString());
  expect(payload).toEqual({ stemPreview: { masterJobId: JOB, stemKey: KEY } });
});

it('refuses a key from another folder', async () => {
  const res = await POST(req('POST', { key: 'audio/mastering/x.wav', filename: 'x.wav' }), p());
  expect(res.status).toBe(400);
  expect(addStem).not.toHaveBeenCalled();
  expect(lambdaSend).not.toHaveBeenCalled();
});

it('renames and removes a stem by id', async () => {
  const sid = '1696000000000_ab12cd34_2_Drums';
  expect((await PATCH(req('PATCH', { name: 'Kick' }), p({ stemId: sid }))).status).toBe(200);
  expect(renameStem).toHaveBeenCalledWith(JOB, sid, 'Kick');
  expect((await DELETE(req('DELETE'), p({ stemId: sid }))).status).toBe(200);
  expect(removeStem).toHaveBeenCalledWith(JOB, sid);
});

it('refuses a path-like stem id', async () => {
  expect((await DELETE(req('DELETE'), p({ stemId: '../x' }))).status).toBe(400);
});

it('still saves the stem and returns 201 when the worker invoke fails, flagging previewQueued false', async () => {
  const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  lambdaSend.mockRejectedValueOnce(new Error('throttled'));
  const res = await POST(req('POST', { key: KEY, filename: '2_Drums.wav' }), p());
  expect(res.status).toBe(201);
  expect(await res.json()).toMatchObject({ success: true, previewQueued: false });
  expect(addStem).toHaveBeenCalledWith(JOB, KEY, '2_Drums.wav');
  errSpy.mockRestore();
});

it("records the stem's previewError when the worker invoke fails, so a reload still shows it", async () => {
  const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  lambdaSend.mockRejectedValueOnce(new Error('throttled'));
  const res = await POST(req('POST', { key: KEY, filename: '2_Drums.wav' }), p());
  const body = await res.json();
  expect(res.status).toBe(201);
  expect(body.previewQueued).toBe(false);
  // Written to the database, not just held in the Lambda response — a GET
  // after a reload must see the same thing.
  expect(setPreviewError).toHaveBeenCalledWith(JOB, SID, expect.stringMatching(/could not be started/i));
  // And reflected in THIS response's set, so the page doesn't need a second
  // round trip to show it.
  expect(body.set.stems[SID].previewError).toMatch(/could not be started/i);
  errSpy.mockRestore();
});

it('clears any old previewError before asking the worker again, on a successful re-POST', async () => {
  addStem.mockResolvedValueOnce({
    masterJobId: JOB, order: [SID],
    stems: { [SID]: { key: KEY, name: 'Drums', previewKey: null, previewError: 'a previous failure' } },
    mix: {}, remix: null,
  });
  const res = await POST(req('POST', { key: KEY, filename: '2_Drums.wav' }), p());
  const body = await res.json();
  expect(res.status).toBe(201);
  expect(setPreviewError).toHaveBeenCalledWith(JOB, SID, null);
  expect(body.set.stems[SID].previewError).toBeNull();
  // Cleared BEFORE the worker is asked to try again, not after.
  expect(setPreviewError.mock.invocationCallOrder[0]).toBeLessThan(lambdaSend.mock.invocationCallOrder[0]);
});

it('stamps previewRequestedAt on the stem whenever it invokes the worker (first add)', async () => {
  const res = await POST(req('POST', { key: KEY, filename: '2_Drums.wav' }), p());
  expect(res.status).toBe(201);
  expect(markPreviewRequested).toHaveBeenCalledWith(JOB, SID, expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/));
  const body = await res.json();
  expect(body.set.stems[SID].previewRequestedAt).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/));
});

it('stamps previewRequestedAt again on a re-POST (Retry), even after the first attempt failed', async () => {
  const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  lambdaSend.mockRejectedValueOnce(new Error('throttled'));
  await POST(req('POST', { key: KEY, filename: '2_Drums.wav' }), p());
  markPreviewRequested.mockClear();

  const res2 = await POST(req('POST', { key: KEY, filename: '2_Drums.wav' }), p());
  expect(res2.status).toBe(201);
  expect(markPreviewRequested).toHaveBeenCalledTimes(1);
  expect(markPreviewRequested).toHaveBeenCalledWith(JOB, SID, expect.any(String));
  errSpy.mockRestore();
});

it('maps a gone stem on rename to 404', async () => {
  const err = new Error('Conditional check failed') as Error & { code?: string };
  err.code = 'ConditionalCheckFailedException';
  renameStem.mockRejectedValueOnce(err);
  const res = await PATCH(req('PATCH', { name: 'Kick' }), p({ stemId: '1696000000000_ab12cd34_2_Drums' }));
  expect(res.status).toBe(404);
});
