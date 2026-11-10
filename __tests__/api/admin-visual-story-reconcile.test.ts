/** @jest-environment node */
/** Reconcile sweep: advances each in-flight video job once, starting none after 6 s; never forwards the request signal. */

import { NextRequest } from 'next/server';

jest.mock('@/lib/auth-helper', () => ({
  ...jest.requireActual('@/lib/auth-helper'),
  requireAdmin: jest.fn(),
}));

const repo = { listInflight: jest.fn() };
jest.mock('@/infrastructure/database/VisualStoryRepository', () => ({
  ...jest.requireActual('@/infrastructure/database/VisualStoryRepository'),
  VisualStoryRepository: jest.fn().mockImplementation(() => repo),
}));

const provider = { id: 'grok', poll: jest.fn() };
jest.mock('@/services/video/providers', () => ({ getVideoProvider: () => provider }));

const mockAdvance = jest.fn();
jest.mock('@/services/video/gen-job', () => ({
  ...jest.requireActual('@/services/video/gen-job'),
  advanceGenJob: (...a: unknown[]) => mockAdvance(...a),
}));

import { POST } from '@/app/api/admin/visual-story/reconcile/route';
import * as auth from '@/lib/auth-helper';
import { VisualStoryRepository } from '@/infrastructure/database/VisualStoryRepository';
import { __resetVisualStoryRateLimitForTests } from '@/lib/visual-story-rate-limit';

const requireAdmin = auth.requireAdmin as jest.Mock;
const URL_ = 'https://tamilagaval.com/api/admin/visual-story/reconcile';
const VS = 'vs_1700000000000_abcdef12';

const job = (n: number, status = 'running') => ({
  jobId: `gj_1700000000000_abcdef0${n}`, sceneOrder: 1, shotOrder: n, status,
});
const inflight = (...ns: number[]) => ns.map((n) => ({ vsId: VS, job: job(n) }));
const post = (withBearer = true, signal?: AbortSignal) =>
  new NextRequest(URL_, { method: 'POST', headers: withBearer ? { Authorization: 'Bearer t' } : undefined, signal });

let logs: jest.SpyInstance;
let now: jest.SpyInstance;
beforeEach(() => {
  jest.resetAllMocks();
  __resetVisualStoryRateLimitForTests();
  (VisualStoryRepository as unknown as jest.Mock).mockImplementation(() => repo);
  logs = jest.spyOn(console, 'error').mockImplementation(() => {});
  now = jest.spyOn(Date, 'now');
  requireAdmin.mockResolvedValue({ userId: 'u1', email: 'a@b.c' });
});
afterEach(() => {
  logs.mockRestore();
  now.mockRestore();
});

describe('POST reconcile', () => {
  it('requires admin and a bearer token, and touches nothing without them', async () => {
    expect((await POST(post(false))).status).toBe(401);
    expect(repo.listInflight).not.toHaveBeenCalled();
    requireAdmin.mockRejectedValue(new Error('Unauthorized'));
    expect((await POST(post())).status).toBeGreaterThanOrEqual(401);
    expect(mockAdvance).not.toHaveBeenCalled();
  });

  it('a finished job whose settle failed is still listed, so the sweep advances (settles) it (audit K1)', async () => {
    now.mockReturnValue(1_000_000);
    const owed = { vsId: VS, job: { ...job(4, 'succeeded'), billedUsd: 0.48 } };
    repo.listInflight.mockResolvedValue([owed]);
    mockAdvance.mockImplementation(async (_r, _p, _vs, j) => ({ ...j, settledAt: 't' }));
    const res = await POST(post());
    expect(mockAdvance).toHaveBeenCalledWith(repo, provider, VS, owed.job);
    expect(await res.json()).toEqual({ success: true, data: { checked: 1, finished: 1, stillRunning: 0 } });
  });

  it('advances every in-flight job once, sequentially, and reports the counts', async () => {
    now.mockReturnValue(1_000_000);
    repo.listInflight.mockResolvedValue(inflight(1, 2, 3));
    let active = 0;
    let overlap = false;
    mockAdvance.mockImplementation(async (_r, _p, _vs, j) => {
      active++;
      if (active > 1) overlap = true;
      await Promise.resolve();
      active--;
      return j.shotOrder === 3 ? { ...j } : { ...j, status: j.shotOrder === 1 ? 'succeeded' : 'failed' };
    });
    const res = await POST(post());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { checked: 3, finished: 2, stillRunning: 1 } });
    expect(mockAdvance).toHaveBeenCalledTimes(3);
    expect(overlap).toBe(false);
    const [r, p, vs, j, ...rest] = mockAdvance.mock.calls[0];
    expect(r).toBe(repo);
    expect(p).toBe(provider);
    expect(vs).toBe(VS);
    expect(j.jobId).toBe(job(1).jobId);
    expect(rest).toEqual([]);
  });

  it('starts no new advance after 6 s (each may take ~22 s) and reports the rest as still running', async () => {
    const t0 = 5_000_000;
    now.mockReturnValue(t0);
    repo.listInflight.mockResolvedValue(inflight(1, 2, 3, 4));
    mockAdvance.mockImplementation(async (_r, _p, _vs, j) => {
      now.mockReturnValue(now() + 3_000);
      return { ...j, status: 'succeeded' };
    });
    const res = await POST(post());
    expect(mockAdvance).toHaveBeenCalledTimes(2); // starts at 0 s and 3 s; 6 s -> stop
    expect(await res.json()).toEqual({ success: true, data: { checked: 2, finished: 2, stillRunning: 2 } });
  });

  it('one slow advance (20 s) is the only one started', async () => {
    now.mockReturnValue(1_000_000);
    repo.listInflight.mockResolvedValue(inflight(1, 2));
    mockAdvance.mockImplementation(async (_r, _p, _vs, j) => {
      now.mockReturnValue(now() + 20_000);
      return j;
    });
    await POST(post());
    expect(mockAdvance).toHaveBeenCalledTimes(1);
  });

  it('one job throwing is counted as still running and the sweep continues', async () => {
    now.mockReturnValue(1_000_000);
    repo.listInflight.mockResolvedValue(inflight(1, 2));
    mockAdvance.mockRejectedValueOnce(new Error('boom')).mockImplementationOnce(async (_r, _p, _vs, j) => ({ ...j, status: 'succeeded' }));
    const res = await POST(post());
    expect(await res.json()).toEqual({ success: true, data: { checked: 2, finished: 1, stillRunning: 1 } });
  });

  it('nothing in flight is a clean zero', async () => {
    now.mockReturnValue(1_000_000);
    repo.listInflight.mockResolvedValue([]);
    expect(await (await POST(post())).json()).toEqual({ success: true, data: { checked: 0, finished: 0, stillRunning: 0 } });
  });

  it('never forwards the request abort signal', async () => {
    now.mockReturnValue(1_000_000);
    repo.listInflight.mockResolvedValue(inflight(1));
    mockAdvance.mockImplementation(async (_r, _p, _vs, j) => j);
    const ac = new AbortController();
    await POST(post(true, ac.signal));
    expect(JSON.stringify(mockAdvance.mock.calls[0].slice(4))).toBe('[]');
    expect(mockAdvance.mock.calls[0].some((a: unknown) => a instanceof AbortSignal)).toBe(false);
  });

  it('a listing failure is a 500 with a plain message', async () => {
    repo.listInflight.mockRejectedValue(new Error('ddb'));
    const res = await POST(post());
    expect(res.status).toBe(500);
    expect((await res.json()).success).toBe(false);
  });
});
