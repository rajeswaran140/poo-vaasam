/** @jest-environment node */
/** Video job route: GET advances the job once; POST {op:'cancel'} cancels it. Never forwards the request signal. */

import { NextRequest } from 'next/server';

jest.mock('@/lib/auth-helper', () => ({
  ...jest.requireActual('@/lib/auth-helper'),
  requireAdmin: jest.fn(),
}));

const repo = { getGenJob: jest.fn() };
jest.mock('@/infrastructure/database/VisualStoryRepository', () => ({
  ...jest.requireActual('@/infrastructure/database/VisualStoryRepository'),
  VisualStoryRepository: jest.fn().mockImplementation(() => repo),
}));

const provider = { id: 'grok', poll: jest.fn() };
jest.mock('@/services/video/providers', () => ({
  getVideoProvider: () => provider,
}));

const mockAdvance = jest.fn();
const mockCancel = jest.fn();
jest.mock('@/services/video/gen-job', () => ({
  ...jest.requireActual('@/services/video/gen-job'),
  advanceGenJob: (...a: unknown[]) => mockAdvance(...a),
  cancelGenJob: (...a: unknown[]) => mockCancel(...a),
}));

import { GET, POST } from '@/app/api/admin/visual-story/[vsId]/video-jobs/[jobId]/route';
import * as auth from '@/lib/auth-helper';
import { VisualStoryRepository } from '@/infrastructure/database/VisualStoryRepository';
import { __resetVisualStoryRateLimitForTests } from '@/lib/visual-story-rate-limit';

const requireAdmin = auth.requireAdmin as jest.Mock;
const VS = 'vs_1700000000000_abcdef12';
const JOB = 'gj_1700000000000_abcdef12';
const bearer = { Authorization: 'Bearer t' };

const job = (over: Record<string, unknown> = {}) => ({
  jobId: JOB,
  sceneOrder: 1,
  shotOrder: 2,
  status: 'running',
  providerId: 'grok',
  providerTaskId: 'req-1',
  reservedUsd: 0.48,
  candId: 'cd_1700000000000_abcdef12',
  attempts: 0,
  copyFailures: 0,
  lastPolledAt: null,
  createdAt: '2026-11-05T10:00:00.000Z',
  updatedAt: '2026-11-05T10:00:00.000Z',
  ...over,
});

const ctx = (jobId = JOB, vsId = VS) => ({ params: Promise.resolve({ vsId, jobId }) });
const get = (signal?: AbortSignal) =>
  new NextRequest(`https://tamilagaval.com/api/admin/visual-story/${VS}/video-jobs/${JOB}`, { signal });
const post = (body: unknown, withBearer = true) =>
  new NextRequest(`https://tamilagaval.com/api/admin/visual-story/${VS}/video-jobs/${JOB}`, {
    method: 'POST',
    headers: withBearer ? { ...bearer, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

let logs: jest.SpyInstance;
beforeEach(() => {
  jest.resetAllMocks();
  __resetVisualStoryRateLimitForTests();
  (VisualStoryRepository as unknown as jest.Mock).mockImplementation(() => repo);
  logs = jest.spyOn(console, 'error').mockImplementation(() => {});
  requireAdmin.mockResolvedValue({ userId: 'u1', email: 'a@b.c' });
  repo.getGenJob.mockResolvedValue(job());
  mockAdvance.mockImplementation(async (_r, _p, _vs, j) => ({ ...j, attempts: j.attempts + 1 }));
  mockCancel.mockImplementation(async (_r, _vs, j) => ({ ...j, status: 'cancelled' }));
});
afterEach(() => logs.mockRestore());

describe('GET (advance once)', () => {
  it('returns { success, data: job } after ONE advance with the grok provider', async () => {
    const res = await GET(get(), ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true, data: { ...job(), attempts: 1 } });
    expect(repo.getGenJob).toHaveBeenCalledWith(VS, JOB);
    expect(mockAdvance).toHaveBeenCalledTimes(1);
    const [r, p, vs, j] = mockAdvance.mock.calls[0];
    expect(r).toBe(repo);
    expect(p).toBe(provider);
    expect(vs).toBe(VS);
    expect(j).toEqual(job());
  });

  it('never forwards the request signal', async () => {
    const ac = new AbortController();
    const req = get(ac.signal);
    await GET(req, ctx());
    for (const arg of mockAdvance.mock.calls[0]) {
      expect(arg).not.toBe(req.signal);
      if (arg && typeof arg === 'object') {
        for (const v of Object.values(arg)) expect(v).not.toBe(req.signal);
      }
    }
  });

  it('unknown job → 404', async () => {
    repo.getGenJob.mockResolvedValue(null);
    const res = await GET(get(), ctx());
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: 'That video no longer exists.' });
    expect(mockAdvance).not.toHaveBeenCalled();
  });

  it.each([
    ['bad jobId', 'dj_1700000000000_abcdef12', VS],
    ['bad vsId', JOB, 'nope'],
  ])('%s → 404 without touching the database', async (_n, jobId, vsId) => {
    const res = await GET(get(), ctx(jobId, vsId));
    expect(res.status).toBe(404);
    expect(repo.getGenJob).not.toHaveBeenCalled();
  });

  it('requires an admin', async () => {
    const err = Object.assign(new Error('Unauthorized'), { name: 'AuthError' });
    requireAdmin.mockRejectedValue(err);
    const res = await GET(get(), ctx());
    expect(res.status).toBeGreaterThanOrEqual(401);
    expect(mockAdvance).not.toHaveBeenCalled();
  });

  it('an advance error → 500 with the generic copy', async () => {
    mockAdvance.mockRejectedValue(new Error('ddb'));
    const res = await GET(get(), ctx());
    expect(res.status).toBe(500);
    expect((await res.json()).success).toBe(false);
  });
});

describe('POST {op:"cancel"}', () => {
  it('cancels and returns { success, data: job }', async () => {
    const res = await POST(post({ op: 'cancel' }), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { ...job(), status: 'cancelled' } });
    expect(mockCancel).toHaveBeenCalledWith(repo, VS, job());
    expect(mockAdvance).not.toHaveBeenCalled();
  });

  it('a finished job → 409 "This video already finished."', async () => {
    mockCancel.mockResolvedValue(null);
    repo.getGenJob.mockResolvedValue(job({ status: 'succeeded' }));
    const res = await POST(post({ op: 'cancel' }), ctx());
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ success: false, error: 'This video already finished.' });
  });

  it('unknown job → 404', async () => {
    repo.getGenJob.mockResolvedValue(null);
    const res = await POST(post({ op: 'cancel' }), ctx());
    expect(res.status).toBe(404);
    expect(mockCancel).not.toHaveBeenCalled();
  });

  it.each([['{"op":"delete"}'], ['not json'], ['{}']])('bad body %s → 400', async (body) => {
    const res = await POST(post(body), ctx());
    expect(res.status).toBe(400);
    expect(mockCancel).not.toHaveBeenCalled();
  });

  it('cookie-only (no bearer) → rejected, nothing cancelled', async () => {
    const res = await POST(post({ op: 'cancel' }, false), ctx());
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(mockCancel).not.toHaveBeenCalled();
  });
});
