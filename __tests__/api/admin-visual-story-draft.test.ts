/** @jest-environment node */
/** Storyboard draft (paid, under the cap, run on the background worker — R14) and apply. */

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
  putDraft: jest.fn(),
  applyDraft: jest.fn(),
  patch: jest.fn(),
  createDraftJob: jest.fn(),
  getDraftJob: jest.fn(),
  transitionDraftJob: jest.fn(),
  listDraftJobs: jest.fn(),
};
jest.mock('@/infrastructure/database/VisualStoryRepository', () => ({
  ...jest.requireActual('@/infrastructure/database/VisualStoryRepository'),
  VisualStoryRepository: jest.fn().mockImplementation(() => repo),
}));

const mockGenerate = jest.fn();
jest.mock('@/services/ai/storyboarder', () => ({
  ...jest.requireActual('@/services/ai/storyboarder'),
  generateStoryboard: (...a: unknown[]) => mockGenerate(...a),
}));

const mockSend = jest.fn();
jest.mock('@aws-sdk/client-lambda', () => ({
  LambdaClient: jest.fn().mockImplementation(() => ({ send: mockSend })),
  InvokeCommand: jest.fn().mockImplementation((input) => ({ input })),
}));

import { POST as draftPOST } from '@/app/api/admin/visual-story/[vsId]/draft/route';
import { GET as jobGET } from '@/app/api/admin/visual-story/[vsId]/draft/jobs/[jobId]/route';
import { POST as applyPOST } from '@/app/api/admin/visual-story/[vsId]/draft/[draftId]/apply/route';
import * as auth from '@/lib/auth-helper';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import {
  VisualStoryRepository,
  DraftTooLargeError,
  NotFoundError,
} from '@/infrastructure/database/VisualStoryRepository';
import { __resetVisualStoryRateLimitForTests } from '@/lib/visual-story-rate-limit';
import { draftReserveUsd } from '@/services/video/cost';
import { DRAFT_JOB_STALE_MS, STALE_DRAFT_ERROR } from '@/services/video/storyboard-job';

const requireAdmin = auth.requireAdmin as jest.Mock;
const VS = 'vs_1700000000000_abcdef12';
const DR = 'dr_1700000000000_abcdef12';
const JOB = 'dj_1700000000000_abcdef12';
const bearer = { Authorization: 'Bearer t' };
const LYRICS = 'Line one of the test song\nLine two';
const RESERVE = draftReserveUsd(LYRICS);

const mk = (body?: unknown, withBearer = true) =>
  new NextRequest('https://tamilagaval.com/api/admin/visual-story/x', {
    method: 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: withBearer ? bearer : undefined,
  });
const ctx = (vsId = VS) => ({ params: Promise.resolve({ vsId }) });
const actx = (draftId = DR, vsId = VS) => ({ params: Promise.resolve({ vsId, draftId }) });
const jctx = (jobId = JOB, vsId = VS) => ({ params: Promise.resolve({ vsId, jobId }) });
const getReq = () => new NextRequest('https://tamilagaval.com/api/admin/visual-story/x/draft/jobs/y');

const story = {
  vsId: VS,
  aspectRatio: '9:16',
  windowStartSec: 10,
  windowEndSec: 55,
  budgetUsdCap: 40,
  spentUsd: 39.95,
  reservedUsd: 0,
  committedUsd: 39.95,
  status: 'DRAFT',
};

beforeEach(() => {
  jest.resetAllMocks();
  (VisualStoryRepository as unknown as jest.Mock).mockImplementation(() => repo);
  __resetVisualStoryRateLimitForTests();
  requireAdmin.mockResolvedValue({ userId: 'admin-1', email: 'a@x.com' });
  repo.findById.mockResolvedValue(story);
  repo.loadTree.mockResolvedValue({ story, scenes: [], shots: [], characters: [], candidates: [], drafts: [] });
  repo.reserve.mockResolvedValue(true);
  repo.settle.mockResolvedValue(undefined);
  repo.putDraft.mockResolvedValue(undefined);
  repo.applyDraft.mockResolvedValue(undefined);
  repo.patch.mockResolvedValue(undefined);
  repo.createDraftJob.mockResolvedValue(undefined);
  repo.listDraftJobs.mockResolvedValue([]);
  repo.transitionDraftJob.mockImplementation(async (_v, jobId, _f, to, fields) => ({
    jobId, status: to, createdAt: 't', updatedAt: 't', reservedUsd: RESERVE, ...fields,
  }));
  // resetAllMocks wipes the factory implementations; restore them.
  (LambdaClient as unknown as jest.Mock).mockImplementation(() => ({ send: mockSend }));
  (InvokeCommand as unknown as jest.Mock).mockImplementation((input) => ({ input }));
  mockSend.mockResolvedValue({ StatusCode: 202 });
});

describe('POST draft (enqueue only)', () => {
  it('no bearer is 401; nothing reserved or invoked', async () => {
    expect((await draftPOST(mk({ lyrics: LYRICS }, false), ctx())).status).toBe(401);
    expect(repo.reserve).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('empty lyrics ⇒ 400, 8001 chars ⇒ 400, before any reserve', async () => {
    expect((await draftPOST(mk({ lyrics: '   ' }), ctx())).status).toBe(400);
    expect((await draftPOST(mk({ lyrics: 'x'.repeat(8001) }), ctx())).status).toBe(400);
    expect((await draftPOST(mk(), ctx())).status).toBe(400);
    expect(repo.reserve).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('malformed vsId and unknown story are 404', async () => {
    expect((await draftPOST(mk({ lyrics: LYRICS }), ctx('../x'))).status).toBe(404);
    repo.findById.mockResolvedValueOnce(null);
    expect((await draftPOST(mk({ lyrics: LYRICS }), ctx())).status).toBe(404);
    expect(repo.reserve).not.toHaveBeenCalled();
  });

  it('202: reserves the length-bounded amount, writes a lyrics-free job, invokes the worker async', async () => {
    const res = await draftPOST(mk({ lyrics: LYRICS }), ctx());
    expect(res.status).toBe(202);
    expect(repo.reserve).toHaveBeenCalledWith(VS, RESERVE);

    const [vsArg, job] = repo.createDraftJob.mock.calls[0];
    expect(vsArg).toBe(VS);
    expect(job).toEqual({
      jobId: expect.stringMatching(/^dj_\d{13}_[a-z0-9]{8}$/),
      status: 'queued',
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
      reservedUsd: RESERVE,
    });
    expect(JSON.stringify(job)).not.toContain('Line one');

    const invoke = mockSend.mock.calls[0][0].input;
    expect(invoke.FunctionName).toBe('tamilagaval-compose-worker');
    expect(invoke.InvocationType).toBe('Event');
    expect(JSON.parse(Buffer.from(invoke.Payload).toString())).toEqual({
      kind: 'storyboard', jobId: job.jobId, vsId: VS, lyrics: LYRICS, windowSec: 45, aspectRatio: '9:16',
    });
    expect(repo.createDraftJob.mock.invocationCallOrder[0]).toBeLessThan(mockSend.mock.invocationCallOrder[0]);

    expect(mockGenerate).not.toHaveBeenCalled(); // never inline on Amplify
    expect(repo.settle).not.toHaveBeenCalled(); // the worker settles
    const body = await res.json();
    expect(body).toEqual({ success: true, data: { jobId: job.jobId } });
  });

  it('releases a dead (10-min-old) job before reserving, so its hold cannot cause a false 402', async () => {
    const stale = new Date(Date.now() - DRAFT_JOB_STALE_MS - 5000).toISOString();
    const dead = { jobId: 'dj_1600000000000_deadbeef', status: 'running', createdAt: stale, updatedAt: stale, reservedUsd: 0.09 };
    repo.listDraftJobs.mockResolvedValueOnce([dead]);
    // DynamoDB returns the stored row (ALL_NEW), so the release uses ITS reservedUsd.
    repo.transitionDraftJob.mockImplementationOnce(async (_v, _j, _f, to, fields) => ({ ...dead, status: to, ...fields }));
    expect((await draftPOST(mk({ lyrics: LYRICS }), ctx())).status).toBe(202);
    expect(repo.settle).toHaveBeenCalledTimes(1);
    expect(repo.settle).toHaveBeenCalledWith(VS, { reservedUsd: 0.09, billedUsd: 0 });
    expect(repo.settle.mock.invocationCallOrder[0]).toBeLessThan(repo.reserve.mock.invocationCallOrder[0]);
  });

  it('honours COMPOSE_WORKER_FUNCTION', async () => {
    process.env.COMPOSE_WORKER_FUNCTION = 'other-worker';
    try {
      await draftPOST(mk({ lyrics: LYRICS }), ctx());
      expect(mockSend.mock.calls[0][0].input.FunctionName).toBe('other-worker');
    } finally {
      delete process.env.COMPOSE_WORKER_FUNCTION;
    }
  });

  it('reserve false ⇒ 402, no job, no invoke', async () => {
    repo.reserve.mockResolvedValueOnce(false);
    const res = await draftPOST(mk({ lyrics: LYRICS }), ctx());
    expect(res.status).toBe(402);
    expect((await res.json()).error).toBe("This would go over the story's budget ($39.95 of $40.00).");
    expect(repo.createDraftJob).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
    expect(repo.settle).not.toHaveBeenCalled();
  });

  it('invoke throws ⇒ job failed (conditional) and released unbilled once, 502', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockSend.mockRejectedValueOnce(new Error('AccessDenied'));
    const res = await draftPOST(mk({ lyrics: LYRICS }), ctx());
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe('Could not start the draft. Please try again.');
    const jobId = repo.createDraftJob.mock.calls[0][1].jobId;
    expect(repo.transitionDraftJob).toHaveBeenCalledWith(VS, jobId, ['queued'], 'failed', {
      code: 'enqueue', error: 'Could not start the draft. Please try again.',
    });
    expect(repo.settle).toHaveBeenCalledTimes(1);
    expect(repo.settle).toHaveBeenCalledWith(VS, { reservedUsd: RESERVE, billedUsd: 0 });
    expect(JSON.stringify(spy.mock.calls)).not.toContain('Line one');
    spy.mockRestore();
  });

  it('invoke throws but the worker already claimed the job ⇒ no release, 202 (the worker settles)', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockSend.mockRejectedValueOnce(new Error('timeout after delivery'));
    repo.transitionDraftJob.mockResolvedValueOnce(null);
    const res = await draftPOST(mk({ lyrics: LYRICS }), ctx());
    expect(res.status).toBe(202);
    expect(repo.settle).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('job write fails ⇒ released, 500, worker never invoked', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    repo.createDraftJob.mockRejectedValueOnce(Object.assign(new Error('ddb'), { name: 'DynamoDBError', statusCode: 500 }));
    const res = await draftPOST(mk({ lyrics: LYRICS }), ctx());
    expect(res.status).toBe(500);
    expect(mockSend).not.toHaveBeenCalled();
    expect(repo.settle).toHaveBeenCalledTimes(1);
    expect(repo.settle).toHaveBeenCalledWith(VS, { reservedUsd: RESERVE, billedUsd: 0 });
    spy.mockRestore();
  });

  it('a release that fails (story deleted) is swallowed; the client still gets the 502', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockSend.mockRejectedValueOnce(new Error('x'));
    repo.settle.mockRejectedValueOnce(new NotFoundError('gone'));
    expect((await draftPOST(mk({ lyrics: LYRICS }), ctx())).status).toBe(502);
    spy.mockRestore();
  });

  it('reserve throws ⇒ 5xx, nothing invoked or settled', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    repo.reserve.mockRejectedValueOnce(new Error('gone'));
    expect((await draftPOST(mk({ lyrics: LYRICS }), ctx())).status).toBe(500);
    expect(mockSend).not.toHaveBeenCalled();
    expect(repo.settle).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('GET draft job', () => {
  const now = Date.now();
  const job = (over: Record<string, unknown> = {}) => ({
    jobId: JOB, status: 'running', createdAt: new Date(now - 30_000).toISOString(), updatedAt: 't', reservedUsd: RESERVE, ...over,
  });

  it('needs an admin but not a bearer (a GET)', async () => {
    const { AuthError } = jest.requireActual('@/lib/auth-helper');
    requireAdmin.mockRejectedValueOnce(new AuthError('Forbidden', 403));
    expect((await jobGET(getReq(), jctx())).status).toBe(403);
    repo.getDraftJob.mockResolvedValueOnce(job());
    expect((await jobGET(getReq(), jctx())).status).toBe(200);
  });

  it('malformed ids and an unknown job are 404', async () => {
    expect((await jobGET(getReq(), jctx('../x'))).status).toBe(404);
    expect((await jobGET(getReq(), jctx(JOB, '../x'))).status).toBe(404);
    repo.getDraftJob.mockResolvedValueOnce(null);
    expect((await jobGET(getReq(), jctx())).status).toBe(404);
  });

  it('a young running job is reported as running, untouched', async () => {
    repo.getDraftJob.mockResolvedValueOnce(job());
    const body = await (await jobGET(getReq(), jctx())).json();
    expect(body).toMatchObject({ success: true, status: 'running' });
    expect(repo.transitionDraftJob).not.toHaveBeenCalled();
    expect(repo.settle).not.toHaveBeenCalled();
  });

  it('done ⇒ { status: done, result: { draftId } } (the pollJob shape)', async () => {
    repo.getDraftJob.mockResolvedValueOnce(job({ status: 'done', draftId: DR }));
    const body = await (await jobGET(getReq(), jctx())).json();
    expect(body).toMatchObject({ success: true, status: 'done', result: { draftId: DR } });
  });

  it('failed ⇒ { status: error, error: { code, message } }', async () => {
    repo.getDraftJob.mockResolvedValueOnce(job({ status: 'failed', code: 'rate_limit', error: 'busy' }));
    const body = await (await jobGET(getReq(), jctx())).json();
    expect(body).toMatchObject({ success: true, status: 'error', error: { code: 'rate_limit', message: 'busy' } });
  });

  it('a job older than 10 minutes is failed and released exactly once', async () => {
    repo.getDraftJob.mockResolvedValueOnce(job({ createdAt: new Date(now - DRAFT_JOB_STALE_MS - 5000).toISOString() }));
    const body = await (await jobGET(getReq(), jctx())).json();
    expect(body).toMatchObject({ status: 'error', error: { message: STALE_DRAFT_ERROR } });
    expect(repo.transitionDraftJob).toHaveBeenCalledWith(VS, JOB, ['queued', 'running'], 'failed', expect.any(Object));
    expect(repo.settle).toHaveBeenCalledTimes(1);
    expect(repo.settle).toHaveBeenCalledWith(VS, { reservedUsd: RESERVE, billedUsd: 0 });
  });

  it('stale-looking job the worker already finished ⇒ no release, reports done', async () => {
    repo.getDraftJob
      .mockResolvedValueOnce(job({ createdAt: new Date(now - DRAFT_JOB_STALE_MS - 5000).toISOString() }))
      .mockResolvedValueOnce(job({ status: 'done', draftId: DR }));
    repo.transitionDraftJob.mockResolvedValueOnce(null);
    const body = await (await jobGET(getReq(), jctx())).json();
    expect(body).toMatchObject({ status: 'done', result: { draftId: DR } });
    expect(repo.settle).not.toHaveBeenCalled();
  });
});

describe('POST apply', () => {
  it('no bearer is 401', async () => {
    expect((await applyPOST(mk(undefined, false), actx())).status).toBe(401);
    expect(repo.applyDraft).not.toHaveBeenCalled();
  });

  it('409s while a clip renders, applies once it is terminal', async () => {
    const t = (status: string) => ({ story, scenes: [], shots: [], characters: [], candidates: [], drafts: [], genJobs: [{ jobId: 'gj_1', status }] });
    for (const status of ['submitted', 'running']) {
      repo.loadTree.mockResolvedValueOnce(t(status));
      const res = await applyPOST(mk(), actx());
      expect(res.status).toBe(409);
      expect((await res.json()).error).toBe('Wait for the video to finish first.');
    }
    expect(repo.applyDraft).not.toHaveBeenCalled();
    expect(repo.patch).not.toHaveBeenCalled();
    repo.loadTree.mockResolvedValue(t('succeeded'));
    expect((await applyPOST(mk(), actx())).status).toBe(200);
    expect(repo.applyDraft).toHaveBeenCalledWith(VS, DR);
  });

  it('malformed ids are 404', async () => {
    expect((await applyPOST(mk(), actx('../x'))).status).toBe(404);
    expect((await applyPOST(mk(), actx(DR, '../x'))).status).toBe(404);
    expect(repo.applyDraft).not.toHaveBeenCalled();
  });

  it('applies, sets STORYBOARDING, returns the tree', async () => {
    const tree = { story: { ...story, status: 'STORYBOARDING' }, scenes: [{ order: 1 }], shots: [], characters: [], candidates: [], drafts: [] };
    repo.loadTree.mockResolvedValueOnce({ ...tree, story }).mockResolvedValueOnce(tree); // guard load, then the applied tree
    const res = await applyPOST(mk(), actx());
    expect(res.status).toBe(200);
    expect(repo.applyDraft).toHaveBeenCalledWith(VS, DR);
    expect(repo.patch).toHaveBeenCalledWith(VS, { status: 'STORYBOARDING' });
    expect(repo.applyDraft.mock.invocationCallOrder[0]).toBeLessThan(repo.patch.mock.invocationCallOrder[0]);
    expect((await res.json()).data).toEqual(tree);
  });

  it('unknown draft ⇒ 404, status untouched', async () => {
    repo.applyDraft.mockRejectedValueOnce(new NotFoundError('nope'));
    expect((await applyPOST(mk(), actx())).status).toBe(404);
    expect(repo.patch).not.toHaveBeenCalled();
  });

  it('DraftTooLargeError ⇒ 400', async () => {
    repo.applyDraft.mockRejectedValueOnce(new DraftTooLargeError(120));
    expect((await applyPOST(mk(), actx())).status).toBe(400);
    expect(repo.patch).not.toHaveBeenCalled();
  });
});
