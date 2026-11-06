/** @jest-environment node */
/** /api/admin/visual-story — auth, create refusals, patch cap guard, delete, rate limit. */

import { NextRequest } from 'next/server';

jest.mock('@/lib/auth-helper', () => ({
  ...jest.requireActual('@/lib/auth-helper'),
  requireAdmin: jest.fn(),
}));

const mockMasterGet = jest.fn();
jest.mock('@/infrastructure/database/MasterJobRepository', () => ({
  MasterJobRepository: jest.fn().mockImplementation(() => ({ get: (...a: unknown[]) => mockMasterGet(...a) })),
}));
const mockContentFind = jest.fn();
jest.mock('@/infrastructure/database/ContentRepository', () => ({
  ContentRepository: jest.fn().mockImplementation(() => ({ findById: (...a: unknown[]) => mockContentFind(...a) })),
}));
const repo = {
  create: jest.fn(),
  list: jest.fn(),
  listByMaster: jest.fn(),
  countShots: jest.fn(),
  loadProgressParts: jest.fn(),
  listInflight: jest.fn(),
  findById: jest.fn(),
  loadTree: jest.fn(),
  patch: jest.fn(),
  remove: jest.fn(),
  listDraftJobs: jest.fn(),
  transitionDraftJob: jest.fn(),
  getDraftJob: jest.fn(),
  settle: jest.fn(),
};
jest.mock('@/infrastructure/database/VisualStoryRepository', () => ({
  ...jest.requireActual('@/infrastructure/database/VisualStoryRepository'),
  VisualStoryRepository: jest.fn().mockImplementation(() => repo),
}));

import { GET, POST } from '@/app/api/admin/visual-story/route';
import { GET as GET_ONE, PATCH, DELETE } from '@/app/api/admin/visual-story/[vsId]/route';
import * as auth from '@/lib/auth-helper';
import { __resetVisualStoryRateLimitForTests } from '@/lib/visual-story-rate-limit';
import { NotFoundError, CapBelowCommittedError } from '@/infrastructure/database/VisualStoryRepository';

const requireAdmin = auth.requireAdmin as jest.Mock;
const URL_ = 'https://tamilagaval.com/api/admin/visual-story';
const VS = 'vs_1700000000000_abcdef12';
const bearer = { Authorization: 'Bearer t' };

const req = (method: string, body?: unknown, withBearer = true, url = URL_) =>
  new NextRequest(url, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: withBearer ? bearer : undefined,
  });
const post = (b: unknown, withBearer = true) => POST(req('POST', b, withBearer));
const ctx = (id = VS) => ({ params: Promise.resolve({ vsId: id }) });

const VALID = {
  masterJobId: 'job-1',
  title: 'Test story',
  aspectRatio: '16:9',
  windowStartSec: 10,
  windowEndSec: 60,
};
const MASTER = { savedAt: '2026-01-01T00:00:00Z', masterKey: 'audio/mastering/x.wav', editedDurationSec: 200 };

beforeEach(() => {
  jest.clearAllMocks();
  __resetVisualStoryRateLimitForTests();
  requireAdmin.mockResolvedValue({ userId: 'admin-1', email: 'a@x.com' });
  mockMasterGet.mockResolvedValue({ ...MASTER });
  mockContentFind.mockResolvedValue({ id: 'c1' });
  repo.create.mockImplementation(async (i) => ({ vsId: VS, ...i }));
  repo.listDraftJobs.mockResolvedValue([]);
});

describe('auth', () => {
  it('GET list returns 401/403 without admin', async () => {
    const { AuthError } = jest.requireActual('@/lib/auth-helper');
    requireAdmin.mockRejectedValueOnce(new AuthError('Unauthorized', 401));
    expect((await GET(req('GET'))).status).toBe(401);
  });
  it('POST without bearer is rejected', async () => {
    const res = await post(VALID, false);
    expect(res.status).toBe(401);
    expect(repo.create).not.toHaveBeenCalled();
  });
  it('PATCH and DELETE without bearer are rejected', async () => {
    expect((await PATCH(req('PATCH', { title: 'x' }, false), ctx())).status).toBe(401);
    expect((await DELETE(req('DELETE', undefined, false), ctx())).status).toBe(401);
    expect(repo.patch).not.toHaveBeenCalled();
    expect(repo.remove).not.toHaveBeenCalled();
  });
});

describe('GET list — each story\'s progress for its card', () => {
  const C = (vs: string) => `audio/mastering/visual-story/${vs}/candidates`;
  const progressTree = (vs: string) => ({
    story: { vsId: vs, windowStartSec: 0, windowEndSec: 12 },
    shots: [
      { sceneOrder: 1, shotOrder: 1, durationSec: 6, selectedCandidateId: 'cd_s' },
      { sceneOrder: 1, shotOrder: 2, durationSec: 6, selectedCandidateId: null },
    ],
    candidates: [{ candId: 'cd_s', mode: 'STILL', s3Key: `${C(vs)}/cd_s.jpg` }],
    renders: [{ renderId: 'rd_1', status: 'done', s3Key: 'v.mp4', createdAt: '2026-11-06T00:00:00Z' }],
  });

  it('adds shots ready, length filled, cover picture and finished video', async () => {
    repo.list.mockResolvedValue([{ vsId: 'b', windowStartSec: 0, windowEndSec: 12 }]);
    repo.loadProgressParts.mockResolvedValue(progressTree('b'));
    const [row] = (await (await GET(req('GET'))).json()).data;
    expect(row).toMatchObject({
      vsId: 'b', shotCount: 2, readyCount: 1, filledSec: 12, windowSec: 12,
      render: 'done', videoKey: 'v.mp4', coverKey: `${C('b')}/cd_s.jpg`,
    });
  });

  it('reads only shots, candidates and renders — never a whole partition — four stories at a time', async () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
    repo.list.mockResolvedValue(ids.map((vsId) => ({ vsId, windowStartSec: 0, windowEndSec: 12 })));
    let open = 0;
    let peak = 0;
    repo.loadProgressParts.mockImplementation(async (id: string) => {
      open++; peak = Math.max(peak, open);
      await new Promise((r) => setTimeout(r, 5));
      open--;
      return progressTree(id);
    });
    const data = (await (await GET(req('GET'))).json()).data;
    expect(data.map((r: { vsId: string }) => r.vsId)).toEqual(ids);
    expect(peak).toBe(4);
    expect(repo.loadTree).not.toHaveBeenCalled();
  });

  it('a story whose read fails keeps its row, without progress', async () => {
    repo.list.mockResolvedValue([{ vsId: 'a' }, { vsId: 'b', windowStartSec: 0, windowEndSec: 12 }]);
    repo.loadProgressParts.mockImplementation(async (id: string) => {
      if (id === 'a') throw new Error('boom');
      return progressTree('b');
    });
    const res = await GET(req('GET'));
    expect(res.status).toBe(200);
    const data = (await res.json()).data;
    expect(data[0]).toEqual({ vsId: 'a', shotCount: null });
    expect(data[1]).toMatchObject({ vsId: 'b', shotCount: 2 });
  });
});

describe('GET list inflightCount', () => {
  it('counts the in-flight video jobs', async () => {
    repo.list.mockResolvedValue([]);
    repo.listInflight.mockResolvedValue([{ vsId: VS, job: {} }, { vsId: VS, job: {} }, { vsId: 'x', job: {} }]);
    expect((await (await GET(req('GET'))).json()).inflightCount).toBe(3);
  });

  it('a failing count is 0 and does not fail the list', async () => {
    repo.list.mockResolvedValue([]);
    repo.listInflight.mockRejectedValue(new Error('boom'));
    const res = await GET(req('GET'));
    expect(res.status).toBe(200);
    expect((await res.json()).inflightCount).toBe(0);
  });
});

describe('GET list', () => {
  it('lists all, or by master', async () => {
    repo.list.mockResolvedValue([{ vsId: VS }]);
    repo.listByMaster.mockResolvedValue([]);
    repo.loadProgressParts.mockRejectedValue(new Error('x'));
    const body = await (await GET(req('GET'))).json();
    expect(body).toEqual({ success: true, data: [{ vsId: VS, shotCount: null }], inflightCount: 0 });
    await GET(req('GET', undefined, true, `${URL_}?masterJobId=job-1`));
    expect(repo.listByMaster).toHaveBeenCalledWith('job-1');
    expect((await GET(req('GET', undefined, true, `${URL_}?masterJobId=a/b`))).status).toBe(400);
  });
});

describe('POST create', () => {
  const err = async (res: Response) => (await res.json()).error;

  it('creates with audioKey = masterKey (201)', async () => {
    const res = await post(VALID);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.audioKey).toBe('audio/mastering/x.wav');
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ audioKey: 'audio/mastering/x.wav' }));
  });
  it('400 on invalid body', async () => {
    expect((await post({ title: 'x' })).status).toBe(400);
    expect((await post({ ...VALID, masterJobId: '../x' })).status).toBe(400);
    expect((await post({ ...VALID, windowEndSec: 20 })).status).toBe(400); // too short
  });
  it('400 on fractional window bounds (R4)', async () => {
    expect((await post({ ...VALID, windowStartSec: 10.5 })).status).toBe(400);
    expect((await post({ ...VALID, windowEndSec: 60.5 })).status).toBe(400);
    expect(repo.create).not.toHaveBeenCalled();
  });
  it('404 when the master is gone', async () => {
    mockMasterGet.mockResolvedValue(null);
    const res = await post(VALID);
    expect(res.status).toBe(404);
    expect(await err(res)).toBe('That master no longer exists.');
  });
  it('400 when the master is not saved', async () => {
    mockMasterGet.mockResolvedValue({ ...MASTER, savedAt: null });
    const res = await post(VALID);
    expect(res.status).toBe(400);
    expect(await err(res)).toBe('Save this master in the library first.');
  });
  it('400 when there is no masterKey', async () => {
    mockMasterGet.mockResolvedValue({ ...MASTER, masterKey: null });
    const res = await post(VALID);
    expect(res.status).toBe(400);
    expect(await err(res)).toBe("This master hasn't finished mastering.");
  });
  it('400 when there is no recorded length', async () => {
    mockMasterGet.mockResolvedValue({ ...MASTER, editedDurationSec: null });
    const res = await post(VALID);
    expect(res.status).toBe(400);
    expect(await err(res)).toBe(
      'This master has no recorded length. Re-open it in Mastering and save it again.'
    );
  });
  it('400 when the window ends after the song (m:ss)', async () => {
    mockMasterGet.mockResolvedValue({ ...MASTER, editedDurationSec: 65 });
    const res = await post({ ...VALID, windowStartSec: 10, windowEndSec: 66 });
    expect(res.status).toBe(400);
    expect(await err(res)).toBe('The window ends after the song does (song is 1:05).');
  });
  it('accepts a window ending exactly at the song end', async () => {
    mockMasterGet.mockResolvedValue({ ...MASTER, editedDurationSec: 60 });
    expect((await post(VALID)).status).toBe(201);
  });
  it('404 for an unknown contentId; 201 for a known one', async () => {
    mockContentFind.mockResolvedValueOnce(null);
    expect((await post({ ...VALID, contentId: 'nope' })).status).toBe(404);
    expect((await post({ ...VALID, contentId: 'c1' })).status).toBe(201);
  });
  it('500 with a generic message on unexpected errors', async () => {
    repo.create.mockRejectedValueOnce(new Error('dynamo secret detail'));
    const res = await post(VALID);
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('secret');
  });
  it('429 on the 21st POST', async () => {
    for (let i = 0; i < 20; i++) expect((await post(VALID)).status).toBe(201);
    expect((await post(VALID)).status).toBe(429);
  });
});

describe('GET one', () => {
  it('returns the tree, 404 when missing or id malformed', async () => {
    repo.loadTree.mockResolvedValueOnce({ story: { vsId: VS }, scenes: [] });
    const res = await GET_ONE(req('GET'), ctx());
    expect((await res.json()).data.story.vsId).toBe(VS);
    repo.loadTree.mockResolvedValueOnce(null);
    expect((await GET_ONE(req('GET'), ctx())).status).toBe(404);
    expect((await GET_ONE(req('GET'), ctx('../x'))).status).toBe(404);
  });
});

describe('GET one — releases a dead draft job before loading (R14 sweep reachability)', () => {
  const stale = new Date(Date.now() - 16 * 60_000).toISOString(); // past DRAFT_JOB_STALE_MS (15 min)
  const fresh = new Date(Date.now() - 30_000).toISOString();
  const job = (createdAt: string) => ({ jobId: 'dj_1700000000000_abcdef12', status: 'queued', createdAt, updatedAt: createdAt, reservedUsd: 0.1 });

  it('a 16-minute-old queued job is failed and released once, before the tree is read', async () => {
    repo.listDraftJobs.mockResolvedValueOnce([job(stale)]);
    repo.transitionDraftJob.mockImplementationOnce(async (_v, jobId, _f, to) => ({ ...job(stale), jobId, status: to }));
    repo.loadTree.mockResolvedValueOnce({ story: { vsId: VS }, scenes: [] });
    expect((await GET_ONE(req('GET'), ctx())).status).toBe(200);
    expect(repo.settle).toHaveBeenCalledTimes(1);
    expect(repo.settle).toHaveBeenCalledWith(VS, { reservedUsd: 0.1, billedUsd: 0 });
    expect(repo.settle.mock.invocationCallOrder[0]).toBeLessThan(repo.loadTree.mock.invocationCallOrder[0]);
  });

  it('a young job is left alone', async () => {
    repo.listDraftJobs.mockResolvedValueOnce([job(fresh)]);
    repo.loadTree.mockResolvedValueOnce({ story: { vsId: VS }, scenes: [] });
    expect((await GET_ONE(req('GET'), ctx())).status).toBe(200);
    expect(repo.transitionDraftJob).not.toHaveBeenCalled();
    expect(repo.settle).not.toHaveBeenCalled();
  });

  it('a failing sweep never blocks the tree', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    repo.listDraftJobs.mockRejectedValueOnce(new Error('ddb'));
    repo.loadTree.mockResolvedValueOnce({ story: { vsId: VS }, scenes: [] });
    expect((await GET_ONE(req('GET'), ctx())).status).toBe(200);
    spy.mockRestore();
  });
});

describe('PATCH', () => {
  beforeEach(() => {
    repo.findById.mockResolvedValue({ vsId: VS, committedUsd: 12.5, budgetUsdCap: 40 });
  });
  it('409 when the cap is below committed', async () => {
    const res = await PATCH(req('PATCH', { budgetUsdCap: 10 }), ctx());
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe(
      "The cap can't go below what's already spent or reserved ($12.50)."
    );
    expect(repo.patch).not.toHaveBeenCalled();
  });
  it('allows a cap equal to committed and patches', async () => {
    const res = await PATCH(req('PATCH', { budgetUsdCap: 12.5, title: 'New' }), ctx());
    expect(res.status).toBe(200);
    expect(repo.patch).toHaveBeenCalledWith(VS, { budgetUsdCap: 12.5, title: 'New' });
  });
  it('400 on empty or invalid body; 404 for unknown story', async () => {
    expect((await PATCH(req('PATCH', {}), ctx())).status).toBe(400);
    expect((await PATCH(req('PATCH', { status: 'BOGUS' }), ctx())).status).toBe(400);
    repo.findById.mockResolvedValue(null);
    expect((await PATCH(req('PATCH', { title: 'x' }), ctx())).status).toBe(404);
  });
  it('maps a repository CapBelowCommittedError (race lost) to 409 with the same copy', async () => {
    repo.patch.mockRejectedValueOnce(new CapBelowCommittedError(15));
    const res = await PATCH(req('PATCH', { budgetUsdCap: 20 }), ctx());
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe(
      "The cap can't go below what's already spent or reserved ($15.00)."
    );
  });
  it('maps a repository NotFoundError to 404', async () => {
    repo.patch.mockRejectedValueOnce(new NotFoundError('gone'));
    expect((await PATCH(req('PATCH', { title: 'x' }), ctx())).status).toBe(404);
  });
});

describe('DELETE', () => {
  it('removes the partition', async () => {
    const res = await DELETE(req('DELETE'), ctx());
    expect(res.status).toBe(200);
    expect(repo.remove).toHaveBeenCalledWith(VS);
  });
  it('409s while a clip renders, deletes once it is terminal', async () => {
    for (const status of ['submitted', 'running']) {
      repo.loadTree.mockResolvedValueOnce({ genJobs: [{ jobId: 'gj_1', status }] });
      const res = await DELETE(req('DELETE'), ctx());
      expect(res.status).toBe(409);
      expect((await res.json()).error).toBe('Wait for the video to finish first.');
    }
    expect(repo.remove).not.toHaveBeenCalled();
    repo.loadTree.mockResolvedValueOnce({ genJobs: [{ jobId: 'gj_1', status: 'failed' }] });
    expect((await DELETE(req('DELETE'), ctx())).status).toBe(200);
    expect(repo.remove).toHaveBeenCalledWith(VS);
  });
  it('409s while a draft is being made (it would settle against a deleted story)', async () => {
    const now = new Date().toISOString();
    for (const status of ['queued', 'running']) {
      repo.listDraftJobs.mockResolvedValue([{ jobId: 'dj_1', status, createdAt: now, updatedAt: now, reservedUsd: 0.1 }]);
      const res = await DELETE(req('DELETE'), ctx());
      expect(res.status).toBe(409);
      expect((await res.json()).error).toBe('Wait for the draft to finish first.');
    }
    expect(repo.remove).not.toHaveBeenCalled();
    repo.listDraftJobs.mockResolvedValue([{ jobId: 'dj_1', status: 'failed', createdAt: now, updatedAt: now, reservedUsd: 0.1 }]);
    expect((await DELETE(req('DELETE'), ctx())).status).toBe(200);
  });
  it('sweeps a dead draft first, so it never blocks the delete forever', async () => {
    const old = new Date(Date.now() - 11 * 60 * 1000).toISOString();
    const dead = { jobId: 'dj_1', status: 'running', createdAt: old, updatedAt: old, reservedUsd: 0.1 };
    repo.listDraftJobs.mockResolvedValueOnce([dead]).mockResolvedValueOnce([]);
    expect((await DELETE(req('DELETE'), ctx())).status).toBe(200);
    expect(repo.remove).toHaveBeenCalledWith(VS);
  });
  it('404 for a malformed id without touching the repo', async () => {
    expect((await DELETE(req('DELETE'), ctx('bad'))).status).toBe(404);
    expect(repo.remove).not.toHaveBeenCalled();
  });
});

describe('PATCH style', () => {
  beforeEach(() => {
    repo.findById.mockResolvedValue({ vsId: VS, committedUsd: 0, budgetUsdCap: 40 });
  });
  it('saves the style trimmed, and lets it be cleared', async () => {
    expect((await PATCH(req('PATCH', { style: '  warm cinematic film ' }), ctx())).status).toBe(200);
    expect(repo.patch).toHaveBeenCalledWith(VS, { style: 'warm cinematic film' });
    expect((await PATCH(req('PATCH', { style: '' }), ctx())).status).toBe(200);
    expect(repo.patch).toHaveBeenLastCalledWith(VS, { style: '' });
  });
  it('refuses a style over 300 characters, saying so', async () => {
    const res = await PATCH(req('PATCH', { style: 'x'.repeat(301) }), ctx());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Keep the style under 300 characters');
  });
});

describe('PATCH style — whitespace', () => {
  it('treats a style of only spaces as none', async () => {
    repo.findById.mockResolvedValue({ vsId: VS, committedUsd: 0, budgetUsdCap: 40 });
    expect((await PATCH(req('PATCH', { style: '   ' }), ctx())).status).toBe(200);
    expect(repo.patch).toHaveBeenLastCalledWith(VS, { style: '' });
  });
});
