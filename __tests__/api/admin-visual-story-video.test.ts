/** @jest-environment node */
/** Make-video: reserve under the hard budget cap → job row → Grok submit (no client signal). */

import { NextRequest } from 'next/server';

jest.mock('@/lib/auth-helper', () => ({
  ...jest.requireActual('@/lib/auth-helper'),
  requireAdmin: jest.fn(),
}));

const repo = {
  loadTree: jest.fn(),
  reserve: jest.fn(),
  settle: jest.fn(),
  createGenJob: jest.fn(),
  transitionGenJob: jest.fn(),
};
jest.mock('@/infrastructure/database/VisualStoryRepository', () => ({
  ...jest.requireActual('@/infrastructure/database/VisualStoryRepository'),
  VisualStoryRepository: jest.fn().mockImplementation(() => repo),
}));

const mockSign = jest.fn();
jest.mock('@/infrastructure/storage/s3-client', () => ({
  S3Operations: { getSignedUrl: (...a: unknown[]) => mockSign(...a) },
}));

const provider = {
  id: 'grok',
  model: 'grok-imagine-video-1.5',
  isConfigured: jest.fn(),
  estimateCostUsd: jest.fn(),
  submit: jest.fn(),
  poll: jest.fn(),
};
jest.mock('@/services/video/providers', () => ({
  getVideoProvider: () => provider,
}));

import { POST } from '@/app/api/admin/visual-story/[vsId]/shots/[shotKey]/video/route';
import { buildVideoRequest } from '@/services/video/gen-job';
import * as auth from '@/lib/auth-helper';
import { VisualStoryRepository } from '@/infrastructure/database/VisualStoryRepository';
import { __resetVisualStoryRateLimitForTests } from '@/lib/visual-story-rate-limit';
import { candIdForJob, isGenJobId } from '@/types/visualStory';

const requireAdmin = auth.requireAdmin as jest.Mock;
const VS = 'vs_1700000000000_abcdef12';
const CH = 'ch_1700000000000_abcdef12';
const CH2 = 'ch_1700000000001_abcdef12';
const STILL = 'cd_1700000000000_abcdef12';
const OTHER_STILL = 'cd_1700000000001_abcdef12';
const CLIP = 'cd_1700000000002_abcdef12';
const bearer = { Authorization: 'Bearer t' };

const mk = (withBearer = true, signal?: AbortSignal) =>
  new NextRequest('https://tamilagaval.com/api/admin/visual-story/x', {
    method: 'POST',
    headers: withBearer ? bearer : undefined,
    signal,
  });
const sctx = (shotKey = '001-002', vsId = VS) => ({ params: Promise.resolve({ vsId, shotKey }) });

const shot = (sceneOrder: number, shotOrder: number, over: Record<string, unknown> = {}) => ({
  sceneOrder,
  shotOrder,
  mode: 'HERO',
  durationSec: 6,
  startSec: 0,
  visualPrompt: 'A lamp on a window sill at dusk',
  negativePrompt: '',
  charIds: [],
  selectedCandidateId: null,
  ...over,
});
const cand = (candId: string, sceneOrder: number, shotOrder: number, mode = 'STILL') => ({
  candId,
  sceneOrder,
  shotOrder,
  jobId: null,
  providerId: 'grok-image',
  providerTaskId: null,
  s3Key: `audio/mastering/visual-story/${VS}/candidates/${candId}.${mode === 'STILL' ? 'jpg' : 'mp4'}`,
  costUsd: 0.02,
  mode,
  createdAt: 't',
});
const job = (over: Record<string, unknown> = {}) => ({
  jobId: 'gj_1700000000000_abcdef12',
  sceneOrder: 1,
  shotOrder: 2,
  status: 'running',
  providerId: 'grok',
  providerTaskId: 'req-0',
  reservedUsd: 0.48,
  candId: 'cd_1700000000000_abcdef12',
  attempts: 0,
  copyFailures: 0,
  lastPolledAt: null,
  createdAt: 't',
  updatedAt: 't',
  ...over,
});
const tree = (over: Record<string, unknown> = {}) => ({
  story: {
    vsId: VS,
    aspectRatio: '9:16',
    windowStartSec: 0,
    windowEndSec: 30,
    budgetUsdCap: 40,
    spentUsd: 39.9,
    reservedUsd: 0,
    committedUsd: 39.9,
  },
  scenes: [{ order: 1, heading: 'Scene 1', summary: '' }],
  shots: [shot(1, 1), shot(1, 2, { charIds: [CH], firstFrameCandidateId: STILL })],
  characters: [
    {
      charId: CH,
      name: 'Test girl',
      description: 'a girl in a yellow half-saree',
      refImageKeys: ['audio/mastering/visual-story/ref/a.jpg', 'audio/mastering/visual-story/ref/b.jpg'],
      createdAt: 't',
    },
  ],
  candidates: [cand(STILL, 1, 2), cand(OTHER_STILL, 1, 1), cand(CLIP, 1, 2, 'HERO')],
  drafts: [],
  genJobs: [],
  ...over,
});

const signed = (key: string) => `https://signed.example/${key}?sig=1`;

beforeEach(() => {
  jest.resetAllMocks();
  (VisualStoryRepository as unknown as jest.Mock).mockImplementation(() => repo);
  __resetVisualStoryRateLimitForTests();
  requireAdmin.mockResolvedValue({ userId: 'admin-1', email: 'a@x.com' });
  repo.loadTree.mockResolvedValue(tree());
  repo.reserve.mockResolvedValue(true);
  repo.settle.mockResolvedValue(undefined);
  repo.createGenJob.mockResolvedValue(undefined);
  repo.transitionGenJob.mockImplementation(async (_vs: string, jobId: string, _from: string[], to: string, fields = {}) =>
    job({ jobId, status: to, ...fields })
  );
  mockSign.mockImplementation(async (key: string) => signed(key));
  provider.isConfigured.mockResolvedValue(true);
  provider.submit.mockResolvedValue({ ok: true, providerTaskId: 'req-123', estimatedCostUsd: 0.48 });
});

describe('POST video — auth, lookup, guards', () => {
  it('no bearer ⇒ 401, nothing reserved or submitted', async () => {
    expect((await POST(mk(false), sctx())).status).toBe(401);
    expect(repo.reserve).not.toHaveBeenCalled();
    expect(provider.submit).not.toHaveBeenCalled();
  });

  it('malformed ids ⇒ 404 before any read', async () => {
    expect((await POST(mk(), sctx('1-2'))).status).toBe(404);
    expect((await POST(mk(), sctx('001-002', '../x'))).status).toBe(404);
    expect(repo.loadTree).not.toHaveBeenCalled();
  });

  it('unknown story or shot ⇒ 404, nothing reserved', async () => {
    repo.loadTree.mockResolvedValueOnce(null);
    expect((await POST(mk(), sctx())).status).toBe(404);
    expect((await POST(mk(), sctx('001-009'))).status).toBe(404);
    expect(repo.reserve).not.toHaveBeenCalled();
  });

  it('empty prompt ⇒ 400 "Write a visual prompt first.", nothing reserved', async () => {
    repo.loadTree.mockResolvedValueOnce(tree({ shots: [shot(1, 2, { visualPrompt: '   ' })] }));
    const res = await POST(mk(), sctx());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Write a visual prompt first.');
    expect(repo.reserve).not.toHaveBeenCalled();
    expect(provider.submit).not.toHaveBeenCalled();
  });

  it.each(['submitted', 'running'])('second press while a job is %s ⇒ 409, no reserve, no submit', async (status) => {
    repo.loadTree.mockResolvedValueOnce(tree({ genJobs: [job({ status })] }));
    const res = await POST(mk(), sctx());
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('A video is already rendering for this shot.');
    expect(repo.reserve).not.toHaveBeenCalled();
    expect(repo.createGenJob).not.toHaveBeenCalled();
    expect(provider.submit).not.toHaveBeenCalled();
  });

  it('a finished job, or one for another shot, does not block', async () => {
    repo.loadTree.mockResolvedValueOnce(
      tree({ genJobs: [job({ status: 'failed' }), job({ status: 'succeeded' }), job({ shotOrder: 1, status: 'running' })] })
    );
    expect((await POST(mk(), sctx())).status).toBe(202);
  });

  it('provider not configured ⇒ 503, nothing reserved', async () => {
    provider.isConfigured.mockResolvedValueOnce(false);
    const res = await POST(mk(), sctx());
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe('Grok video generation is not configured.');
    expect(repo.reserve).not.toHaveBeenCalled();
    expect(provider.submit).not.toHaveBeenCalled();
  });
});

describe('POST video — money paths', () => {
  it('happy path: reserves $0.48 for 6 s, creates the job, submits without a signal, 202 with jobId', async () => {
    const req = mk();
    const res = await POST(req, sctx());
    expect(res.status).toBe(202);

    expect(repo.reserve).toHaveBeenCalledTimes(1);
    expect(repo.reserve).toHaveBeenCalledWith(VS, 0.48);

    expect(repo.createGenJob).toHaveBeenCalledTimes(1);
    const [vsArg, created] = repo.createGenJob.mock.calls[0];
    expect(vsArg).toBe(VS);
    expect(isGenJobId(created.jobId)).toBe(true);
    expect(created).toEqual({
      jobId: created.jobId,
      sceneOrder: 1,
      shotOrder: 2,
      status: 'submitted',
      providerId: 'grok',
      providerTaskId: null,
      reservedUsd: 0.48,
      candId: candIdForJob(created.jobId),
      attempts: 0,
      copyFailures: 0,
      lastPolledAt: null,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });

    expect(provider.submit).toHaveBeenCalledTimes(1);
    const sub = provider.submit.mock.calls[0][0];
    expect(sub.signal).toBeUndefined();
    expect(sub.signal).not.toBe(req.signal);
    expect(sub.mode).toBe('HERO');
    expect(sub.durationSec).toBe(6);
    expect(sub.aspectRatio).toBe('9:16');
    expect(sub.firstFrameUrl).toBe(signed(cand(STILL, 1, 2).s3Key));
    expect(sub.referenceImageUrls).toEqual([
      signed('audio/mastering/visual-story/ref/a.jpg'),
      signed('audio/mastering/visual-story/ref/b.jpg'),
    ]);
    expect(mockSign).toHaveBeenCalledWith(cand(STILL, 1, 2).s3Key, 3600);
    expect(mockSign).toHaveBeenCalledWith('audio/mastering/visual-story/ref/a.jpg', 3600);

    expect(repo.transitionGenJob).toHaveBeenCalledTimes(1);
    expect(repo.transitionGenJob).toHaveBeenCalledWith(VS, created.jobId, ['submitted'], 'running', {
      providerTaskId: 'req-123',
    });
    // The reservation stays held: the job's poller settles it.
    expect(repo.settle).not.toHaveBeenCalled();

    expect(await res.json()).toEqual({ success: true, data: { jobId: created.jobId } });
  });

  it('reserve false ⇒ 402 with the spend copy; no job, no submit, no settle', async () => {
    repo.reserve.mockResolvedValueOnce(false);
    const res = await POST(mk(), sctx());
    expect(res.status).toBe(402);
    expect((await res.json()).error).toBe("This would go over the story's budget ($39.90 of $40.00).");
    expect(repo.createGenJob).not.toHaveBeenCalled();
    expect(provider.submit).not.toHaveBeenCalled();
    expect(repo.settle).not.toHaveBeenCalled();
  });

  it('submit rate_limit ⇒ 429, job failed with code+error, settled unbilled once', async () => {
    provider.submit.mockResolvedValueOnce({
      ok: false, code: 'rate_limit', error: 'The video service is rate-limited; please retry shortly.',
    });
    const res = await POST(mk(), sctx());
    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe('The video service is rate-limited; please retry shortly.');
    const jobId = repo.createGenJob.mock.calls[0][1].jobId;
    expect(repo.transitionGenJob).toHaveBeenCalledTimes(1);
    expect(repo.transitionGenJob).toHaveBeenCalledWith(VS, jobId, ['submitted'], 'failed', {
      code: 'rate_limit',
      error: 'The video service is rate-limited; please retry shortly.',
    });
    expect(repo.settle).toHaveBeenCalledTimes(1);
    expect(repo.settle).toHaveBeenCalledWith(VS, { reservedUsd: 0.48, billedUsd: 0 });
  });

  it.each([
    ['billing', 503],
    ['not_configured', 503],
    ['content_policy', 422],
    ['auth', 502],
    ['upstream', 502],
    ['bad_response', 502],
  ])('submit %s ⇒ %i, settled unbilled once', async (code, status) => {
    provider.submit.mockResolvedValueOnce({ ok: false, code, error: 'x' });
    expect((await POST(mk(), sctx())).status).toBe(status);
    expect(repo.settle).toHaveBeenCalledTimes(1);
    expect(repo.settle).toHaveBeenCalledWith(VS, { reservedUsd: 0.48, billedUsd: 0 });
  });

  it('thrown submit ⇒ 502 upstream, job failed, settled unbilled once', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    provider.submit.mockRejectedValueOnce(new Error('AccessDeniedException'));
    const res = await POST(mk(), sctx());
    expect(res.status).toBe(502);
    expect(repo.transitionGenJob).toHaveBeenCalledWith(
      VS, expect.any(String), ['submitted'], 'failed', expect.objectContaining({ code: 'upstream' })
    );
    expect(repo.settle).toHaveBeenCalledTimes(1);
    expect(repo.settle).toHaveBeenCalledWith(VS, { reservedUsd: 0.48, billedUsd: 0 });
    spy.mockRestore();
  });

  it('failed transition lost (job no longer submitted) ⇒ no settle, error still returned', async () => {
    provider.submit.mockResolvedValueOnce({ ok: false, code: 'rate_limit', error: 'x' });
    repo.transitionGenJob.mockResolvedValueOnce(null);
    expect((await POST(mk(), sctx())).status).toBe(429);
    expect(repo.settle).not.toHaveBeenCalled();
  });

  it('failed transition throws ⇒ no settle (the stale sweep owns it), error still returned', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    provider.submit.mockResolvedValueOnce({ ok: false, code: 'content_policy', error: 'blocked' });
    repo.transitionGenJob.mockRejectedValueOnce(new Error('ddb down'));
    expect((await POST(mk(), sctx())).status).toBe(422);
    expect(repo.settle).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('createGenJob throws after reserve ⇒ released once, provider never called', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    repo.createGenJob.mockRejectedValueOnce(new Error('ddb down'));
    const res = await POST(mk(), sctx());
    expect(res.status).toBe(500);
    expect(provider.submit).not.toHaveBeenCalled();
    expect(repo.settle).toHaveBeenCalledTimes(1);
    expect(repo.settle).toHaveBeenCalledWith(VS, { reservedUsd: 0.48, billedUsd: 0 });
    spy.mockRestore();
  });

  it('signing throws ⇒ nothing reserved (URLs are built before the reservation)', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockSign.mockRejectedValueOnce(new Error('no creds'));
    const res = await POST(mk(), sctx());
    expect(res.status).toBe(500);
    expect(repo.reserve).not.toHaveBeenCalled();
    expect(provider.submit).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('running transition fails after an accepted submit ⇒ still 202, never settled', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    repo.transitionGenJob.mockRejectedValueOnce(new Error('ddb down'));
    const res = await POST(mk(), sctx());
    expect(res.status).toBe(202);
    expect(repo.settle).not.toHaveBeenCalled();

    repo.transitionGenJob.mockResolvedValueOnce(null);
    expect((await POST(mk(), sctx())).status).toBe(202);
    expect(repo.settle).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('settle throwing keeps the provider error response', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    provider.submit.mockResolvedValueOnce({ ok: false, code: 'rate_limit', error: 'x' });
    repo.settle.mockRejectedValueOnce(new Error('ddb down'));
    expect((await POST(mk(), sctx())).status).toBe(429);
    expect(repo.settle).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('an aborted client request does not reach the paid call', async () => {
    const ac = new AbortController();
    ac.abort();
    const res = await POST(mk(true, ac.signal), sctx());
    expect(res.status).toBe(202);
    expect(provider.submit.mock.calls[0][0].signal).toBeUndefined();
  });
});

describe('buildVideoRequest', () => {
  const t = (over: Record<string, unknown> = {}) => tree(over) as unknown as Parameters<typeof buildVideoRequest>[0];

  it('prompt carries the shot prompt and each cast member, with <IMAGE_n> tags for references', async () => {
    const req = await buildVideoRequest(t(), tree().shots[1] as never);
    expect(req.prompt).toContain('A lamp on a window sill at dusk');
    expect(req.prompt).toContain('Test girl: a girl in a yellow half-saree');
    expect(req.prompt).toContain('<IMAGE_0>');
    expect(req.prompt).toContain('<IMAGE_1>');
    expect(req.mode).toBe('HERO');
    expect(req.aspectRatio).toBe('9:16');
    expect(req.durationSec).toBe(6);
    expect(req.signal).toBeUndefined();
  });

  it('no cast ⇒ the bare shot prompt, no references, no first frame', async () => {
    const req = await buildVideoRequest(t(), tree().shots[0] as never);
    expect(req.prompt).toBe('A lamp on a window sill at dusk');
    expect(req.referenceImageUrls).toBeUndefined();
    expect(req.firstFrameUrl).toBeUndefined();
  });

  it.each([
    ['another shot’s still', OTHER_STILL],
    ['a video candidate', CLIP],
    ['a missing candidate', 'cd_1700000000009_abcdef12'],
  ])('first frame naming %s is ignored', async (_label, candId) => {
    const s = shot(1, 2, { firstFrameCandidateId: candId });
    const req = await buildVideoRequest(t(), s as never);
    expect(req.firstFrameUrl).toBeUndefined();
  });

  it('references follow the cast order, skip unknown characters, and cap at 14 before signing', async () => {
    const keys = (p: string, n: number) => Array.from({ length: n }, (_, i) => `ref/${p}${i}.jpg`);
    const characters = [
      { charId: CH, name: 'A', description: '', refImageKeys: keys('a', 10), createdAt: 't' },
      { charId: CH2, name: 'B', description: 'tall', refImageKeys: keys('b', 10), createdAt: 't' },
    ];
    const s = shot(1, 2, { charIds: [CH2, 'ch_1700000000009_abcdef12', CH] });
    const req = await buildVideoRequest(t({ characters }), s as never);
    expect(req.referenceImageUrls).toEqual([...keys('b', 10), ...keys('a', 4)].map(signed));
    expect(mockSign).toHaveBeenCalledTimes(14);
    expect(req.prompt).toContain('B: tall');
    expect(req.prompt).toMatch(/\nA\b/);
    expect(req.prompt).toContain('<IMAGE_13>');
    expect(req.prompt).not.toContain('<IMAGE_14>');
  });
});
