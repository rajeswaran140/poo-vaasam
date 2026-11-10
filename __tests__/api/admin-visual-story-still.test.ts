/** @jest-environment node */
/** STILL generation under the hard budget cap, and candidate selection. */

import { NextRequest } from 'next/server';

jest.mock('@/lib/auth-helper', () => ({
  ...jest.requireActual('@/lib/auth-helper'),
  requireAdmin: jest.fn(),
}));

const repo = {
  loadTree: jest.fn(),
  findById: jest.fn(),
  reserve: jest.fn(),
  settle: jest.fn(),
  putCandidate: jest.fn(),
  selectCandidate: jest.fn(),
  selectCandidateIfNone: jest.fn(),
};
jest.mock('@/infrastructure/database/VisualStoryRepository', () => ({
  ...jest.requireActual('@/infrastructure/database/VisualStoryRepository'),
  VisualStoryRepository: jest.fn().mockImplementation(() => repo),
}));

const mockUpload = jest.fn();
jest.mock('@/infrastructure/storage/s3-client', () => ({
  S3Operations: { uploadFile: (...a: unknown[]) => mockUpload(...a) },
}));

const mockGenerate = jest.fn();
jest.mock('@/services/video/image-providers', () => ({
  generateStillImage: (...a: unknown[]) => mockGenerate(...a),
}));

import { POST as stillPOST } from '@/app/api/admin/visual-story/[vsId]/shots/[shotKey]/still/route';
import { POST as selectPOST } from '@/app/api/admin/visual-story/[vsId]/select/route';
import * as auth from '@/lib/auth-helper';
import { VisualStoryRepository, NotFoundError } from '@/infrastructure/database/VisualStoryRepository';
import { __resetVisualStoryRateLimitForTests } from '@/lib/visual-story-rate-limit';
import { VISUAL_STORY_PREFIX } from '@/lib/visual-story-storage';

const requireAdmin = auth.requireAdmin as jest.Mock;
const VS = 'vs_1700000000000_abcdef12';
const CH = 'ch_1700000000000_abcdef12';
const CD = 'cd_1700000000000_abcdef12';
const CD2 = 'cd_1700000000001_abcdef12';
const bearer = { Authorization: 'Bearer t' };

const mk = (body?: unknown, withBearer = true) =>
  new NextRequest('https://tamilagaval.com/api/admin/visual-story/x', {
    method: 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: withBearer ? bearer : undefined,
  });
const sctx = (shotKey = '001-002', vsId = VS) => ({ params: Promise.resolve({ vsId, shotKey }) });
const ctx = (vsId = VS) => ({ params: Promise.resolve({ vsId }) });

const shot = (sceneOrder: number, shotOrder: number, over: Record<string, unknown> = {}) => ({
  sceneOrder,
  shotOrder,
  mode: 'STILL',
  durationSec: 8,
  startSec: 0,
  visualPrompt: 'A lamp on a window sill at dusk',
  negativePrompt: '',
  charIds: [],
  selectedCandidateId: null,
  ...over,
});
const cand = (candId: string, sceneOrder: number, shotOrder: number) => ({
  candId,
  sceneOrder,
  shotOrder,
  jobId: null,
  providerId: 'grok-image',
  providerTaskId: null,
  s3Key: `${VISUAL_STORY_PREFIX}${VS}/candidates/${candId}.jpg`,
  costUsd: 0.02,
  mode: 'STILL',
  createdAt: 't',
});
const tree = (over: Record<string, unknown> = {}) => ({
  story: {
    vsId: VS,
    aspectRatio: '9:16',
    windowStartSec: 0,
    windowEndSec: 30,
    budgetUsdCap: 40,
    spentUsd: 39.99,
    reservedUsd: 0,
    committedUsd: 39.99,
  },
  scenes: [{ order: 1, heading: 'Scene 1', summary: '' }],
  shots: [shot(1, 1), shot(1, 2, { charIds: [CH] })],
  characters: [
    { charId: CH, name: 'Test girl', description: 'a girl in a yellow half-saree', refImageKeys: [], createdAt: 't' },
  ],
  candidates: [cand(CD, 1, 2), cand(CD2, 1, 1)],
  drafts: [],
  ...over,
});

const okImage = { ok: true, bytes: Buffer.from('jpegbytes'), contentType: 'image/jpeg', billed: true };

beforeEach(() => {
  jest.resetAllMocks();
  (VisualStoryRepository as unknown as jest.Mock).mockImplementation(() => repo);
  __resetVisualStoryRateLimitForTests();
  requireAdmin.mockResolvedValue({ userId: 'admin-1', email: 'a@x.com' });
  repo.loadTree.mockResolvedValue(tree());
  repo.reserve.mockResolvedValue(true);
  repo.settle.mockResolvedValue(undefined);
  repo.putCandidate.mockResolvedValue(undefined);
  repo.selectCandidate.mockResolvedValue(undefined);
  repo.selectCandidateIfNone.mockResolvedValue(true);
  mockUpload.mockResolvedValue({ key: 'k', url: 'u', bucket: 'b' });
  mockGenerate.mockResolvedValue(okImage);
});

describe('POST still — auth and lookup', () => {
  it('no bearer is 401 and nothing is reserved', async () => {
    expect((await stillPOST(mk(undefined, false), sctx())).status).toBe(401);
    expect(repo.reserve).not.toHaveBeenCalled();
    expect(mockGenerate).not.toHaveBeenCalled();
  });
  it('malformed shotKey or vsId is 404 before any read', async () => {
    expect((await stillPOST(mk(), sctx('1-2'))).status).toBe(404);
    expect((await stillPOST(mk(), sctx('001-002', '../x'))).status).toBe(404);
    expect(repo.loadTree).not.toHaveBeenCalled();
  });
  it('unknown story or shot is 404 and nothing is reserved', async () => {
    repo.loadTree.mockResolvedValueOnce(null);
    expect((await stillPOST(mk(), sctx())).status).toBe(404);
    expect((await stillPOST(mk(), sctx('001-009'))).status).toBe(404);
    expect(repo.reserve).not.toHaveBeenCalled();
  });
});

describe('POST still — money paths', () => {
  it('happy path: story aspect, character descriptions, candidates/ key, settled billed 0.02', async () => {
    const res = await stillPOST(mk(), sctx());
    expect(res.status).toBe(201);

    expect(repo.reserve).toHaveBeenCalledWith(VS, 0.02);
    expect(mockGenerate).toHaveBeenCalledTimes(1);
    const req = mockGenerate.mock.calls[0][0];
    expect(req.aspectRatio).toBe('9:16');
    expect(req.providerId).toBe('grok-image');
    expect(req.prompt).toContain('A lamp on a window sill at dusk');
    expect(req.prompt).toContain('a girl in a yellow half-saree');
    expect(req.prompt).toContain('Test girl');

    expect(mockUpload).toHaveBeenCalledTimes(1);
    const up = mockUpload.mock.calls[0][0];
    expect(up.key).toMatch(new RegExp(`^${VISUAL_STORY_PREFIX}${VS}/candidates/cd_\\d{13}_[a-z0-9]+\\.jpg$`));
    expect(up.contentType).toBe('image/jpeg');
    expect(up.file).toEqual(Buffer.from('jpegbytes'));

    expect(repo.putCandidate).toHaveBeenCalledTimes(1);
    const [vsArg, c] = repo.putCandidate.mock.calls[0];
    expect(vsArg).toBe(VS);
    expect(c).toMatchObject({
      sceneOrder: 1,
      shotOrder: 2,
      providerId: 'grok-image',
      providerTaskId: null,
      s3Key: up.key,
      costUsd: 0.02,
      mode: 'STILL',
    });

    expect(repo.settle).toHaveBeenCalledTimes(1);
    expect(repo.settle).toHaveBeenCalledWith(VS, { reservedUsd: 0.02, billedUsd: 0.02 });
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.candidate.candId).toBe(c.candId);
  });

  it('reserve false ⇒ 402 with spend copy; provider never called, nothing settled', async () => {
    repo.reserve.mockResolvedValueOnce(false);
    repo.findById.mockResolvedValueOnce(tree().story);
    const res = await stillPOST(mk(), sctx());
    expect(res.status).toBe(402);
    expect((await res.json()).error).toBe(
      'This needs $0.02, but only $0.01 of the $40.00 budget is left ($39.99 spent).'
    );
    expect(mockGenerate).not.toHaveBeenCalled();
    expect(repo.settle).not.toHaveBeenCalled();
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('content_policy ⇒ 422, settled as billed, nothing saved', async () => {
    mockGenerate.mockResolvedValueOnce({
      ok: false, code: 'content_policy', error: 'The image was blocked by the provider’s content filter.', billed: true,
    });
    const res = await stillPOST(mk(), sctx());
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe('The image was blocked by the provider’s content filter.');
    expect(repo.settle).toHaveBeenCalledTimes(1);
    expect(repo.settle).toHaveBeenCalledWith(VS, { reservedUsd: 0.02, billedUsd: 0.02 });
    expect(mockUpload).not.toHaveBeenCalled();
    expect(repo.putCandidate).not.toHaveBeenCalled();
  });

  it('upstream ⇒ 502, reservation released (billed 0)', async () => {
    mockGenerate.mockResolvedValueOnce({ ok: false, code: 'upstream', error: 'Image generation failed.', billed: false });
    const res = await stillPOST(mk(), sctx());
    expect(res.status).toBe(502);
    expect(repo.settle).toHaveBeenCalledTimes(1);
    expect(repo.settle).toHaveBeenCalledWith(VS, { reservedUsd: 0.02, billedUsd: 0 });
  });

  it('not_configured ⇒ 503, released', async () => {
    mockGenerate.mockResolvedValueOnce({
      ok: false, code: 'not_configured', error: 'Grok image generation is not configured.', billed: false,
    });
    const res = await stillPOST(mk(), sctx());
    expect(res.status).toBe(503);
    expect(repo.settle).toHaveBeenCalledTimes(1);
    expect(repo.settle).toHaveBeenCalledWith(VS, { reservedUsd: 0.02, billedUsd: 0 });
  });

  it.each([
    ['billing', 503],
    ['rate_limit', 429],
    ['auth', 502],
    ['bad_response', 502],
  ])('%s ⇒ %i, released', async (code, status) => {
    mockGenerate.mockResolvedValueOnce({ ok: false, code, error: 'x', billed: false });
    expect((await stillPOST(mk(), sctx())).status).toBe(status);
    expect(repo.settle).toHaveBeenCalledTimes(1);
    expect(repo.settle).toHaveBeenCalledWith(VS, { reservedUsd: 0.02, billedUsd: 0 });
  });

  it('provider THROWS (SSM failure) ⇒ 502, released exactly once', async () => {
    mockGenerate.mockRejectedValueOnce(new Error('AccessDeniedException'));
    const res = await stillPOST(mk(), sctx());
    expect(res.status).toBe(502);
    expect(repo.settle).toHaveBeenCalledTimes(1);
    expect(repo.settle).toHaveBeenCalledWith(VS, { reservedUsd: 0.02, billedUsd: 0 });
    expect(repo.putCandidate).not.toHaveBeenCalled();
  });

  it('S3 put fails after a billed image ⇒ 502 "still charged", settled as billed', async () => {
    mockUpload.mockRejectedValueOnce(new Error('S3 down'));
    const res = await stillPOST(mk(), sctx());
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("The image was made but couldn't be saved; it was still charged.");
    expect(repo.settle).toHaveBeenCalledTimes(1);
    expect(repo.settle).toHaveBeenCalledWith(VS, { reservedUsd: 0.02, billedUsd: 0.02 });
    expect(repo.putCandidate).not.toHaveBeenCalled();
  });

  it('putCandidate fails after the image is saved ⇒ 5xx, settled as billed exactly once', async () => {
    repo.putCandidate.mockRejectedValueOnce(new Error('ddb down'));
    const res = await stillPOST(mk(), sctx());
    expect(res.status).toBe(500);
    expect(repo.settle).toHaveBeenCalledTimes(1);
    expect(repo.settle).toHaveBeenCalledWith(VS, { reservedUsd: 0.02, billedUsd: 0.02 });
  });

  it("chooses the new still when the shot has nothing chosen (the repo keeps an existing choice)", async () => {
    const res = await stillPOST(mk(), sctx());
    expect(res.status).toBe(201);
    const candId = repo.putCandidate.mock.calls[0][1].candId;
    expect(repo.selectCandidateIfNone).toHaveBeenCalledWith(VS, 1, 2, candId);
  });

  it('a failed auto-choose keeps the 201 and the single billed settle', async () => {
    repo.selectCandidateIfNone.mockRejectedValueOnce(new Error('ddb down'));
    const res = await stillPOST(mk(), sctx());
    expect(res.status).toBe(201);
    expect(repo.settle).toHaveBeenCalledTimes(1);
    expect(repo.settle).toHaveBeenCalledWith(VS, { reservedUsd: 0.02, billedUsd: 0.02 });
  });

  it('reserve throws (story vanished) ⇒ 5xx, provider never called, nothing settled', async () => {
    repo.reserve.mockRejectedValueOnce(new Error('reserve: visual story not found'));
    const res = await stillPOST(mk(), sctx());
    expect(res.status).toBe(500);
    expect(mockGenerate).not.toHaveBeenCalled();
    expect(repo.settle).not.toHaveBeenCalled();
  });
});

describe('POST still — review fixes', () => {
  it('the client abort signal is not forwarded to the paid call', async () => {
    const req = mk();
    await stillPOST(req, sctx());
    const arg = mockGenerate.mock.calls[0][0];
    expect(arg.signal).toBeUndefined();
    expect(arg.signal).not.toBe(req.signal);
  });

  it('an aborted client request still settles as billed when the provider succeeds', async () => {
    const ac = new AbortController();
    const req = new NextRequest('https://tamilagaval.com/api/admin/visual-story/x', {
      method: 'POST', headers: bearer, signal: ac.signal,
    });
    mockGenerate.mockImplementationOnce(async (r: { signal?: AbortSignal }) => {
      ac.abort();
      if (r.signal?.aborted) return { ok: false, code: 'upstream', error: 'aborted', billed: false };
      return okImage;
    });
    const res = await stillPOST(req, sctx());
    expect(res.status).toBe(201);
    expect(repo.settle).toHaveBeenCalledTimes(1);
    expect(repo.settle).toHaveBeenCalledWith(VS, { reservedUsd: 0.02, billedUsd: 0.02 });
  });

  it('settle NotFoundError (story deleted mid-call, T3) is logged and swallowed, not sent to the client', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    repo.settle.mockRejectedValueOnce(new NotFoundError('settle: visual story gone'));
    const res = await stillPOST(mk(), sctx());
    expect(res.status).toBe(201);
    expect(JSON.stringify(await res.json())).not.toContain('settle');
    expect(spy).toHaveBeenCalledWith('visual-story still: settle failed', 'NotFoundError');
    spy.mockRestore();
  });

  it('settle throwing keeps the original response', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    repo.settle.mockRejectedValue(new Error('ddb down'));
    expect((await stillPOST(mk(), sctx())).status).toBe(201);

    mockUpload.mockRejectedValueOnce(new Error('S3 down'));
    const charged = await stillPOST(mk(), sctx());
    expect(charged.status).toBe(502);
    expect((await charged.json()).error).toBe("The image was made but couldn't be saved; it was still charged.");

    mockGenerate.mockResolvedValueOnce({ ok: false, code: 'content_policy', error: 'blocked', billed: true });
    expect((await stillPOST(mk(), sctx())).status).toBe(422);
    expect(repo.settle).toHaveBeenCalledTimes(3);
    spy.mockRestore();
  });
});

describe('POST select', () => {
  it('no bearer is 401', async () => {
    expect((await selectPOST(mk({ sceneOrder: 1, shotOrder: 2, candId: CD }, false), ctx())).status).toBe(401);
    expect(repo.selectCandidate).not.toHaveBeenCalled();
  });
  it('selects a candidate of the shot', async () => {
    const res = await selectPOST(mk({ sceneOrder: 1, shotOrder: 2, candId: CD }), ctx());
    expect(res.status).toBe(200);
    expect(repo.selectCandidate).toHaveBeenCalledWith(VS, 1, 2, CD);
    expect((await res.json()).data.shot.selectedCandidateId).toBe(CD);
  });
  it('a candidate from another shot ⇒ 400, nothing written', async () => {
    const res = await selectPOST(mk({ sceneOrder: 1, shotOrder: 2, candId: CD2 }), ctx());
    expect(res.status).toBe(400);
    expect(repo.selectCandidate).not.toHaveBeenCalled();
  });
  it('malformed candId ⇒ 400; unknown shot ⇒ 404', async () => {
    expect((await selectPOST(mk({ sceneOrder: 1, shotOrder: 2, candId: '../x' }), ctx())).status).toBe(400);
    expect((await selectPOST(mk({ sceneOrder: 1, shotOrder: 9, candId: CD }), ctx())).status).toBe(404);
    expect(repo.selectCandidate).not.toHaveBeenCalled();
  });
});

describe('POST still — the story\'s Style', () => {
  it('adds the story\'s style to the picture request', async () => {
    repo.loadTree.mockResolvedValueOnce(tree({ story: { ...tree().story, spentUsd: 0, committedUsd: 0, style: 'warm cinematic film, 35mm' } }));
    expect((await stillPOST(mk(), sctx())).status).toBe(201);
    expect(mockGenerate.mock.calls[0][0].prompt).toMatch(/\n\nVisual style: warm cinematic film, 35mm$/);
  });

  it('sends no style line for a story without one', async () => {
    repo.loadTree.mockResolvedValueOnce(tree({ story: { ...tree().story, spentUsd: 0, committedUsd: 0 } }));
    expect((await stillPOST(mk(), sctx())).status).toBe(201);
    expect(mockGenerate.mock.calls[0][0].prompt).not.toContain('Visual style');
  });
});
