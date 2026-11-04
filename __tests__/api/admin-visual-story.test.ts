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
  findById: jest.fn(),
  loadTree: jest.fn(),
  patch: jest.fn(),
  remove: jest.fn(),
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

describe('GET list shotCount', () => {
  it('a failing count yields null for that row only', async () => {
    repo.list.mockResolvedValue([{ vsId: 'a' }, { vsId: 'b' }]);
    repo.countShots.mockImplementation(async (id: string) => {
      if (id === 'a') throw new Error('boom');
      return 7;
    });
    const res = await GET(req('GET'));
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual([
      { vsId: 'a', shotCount: null },
      { vsId: 'b', shotCount: 7 },
    ]);
  });
});

describe('GET list', () => {
  it('lists all, or by master', async () => {
    repo.list.mockResolvedValue([{ vsId: VS }]);
    repo.listByMaster.mockResolvedValue([]);
    repo.countShots.mockResolvedValue(4);
    const body = await (await GET(req('GET'))).json();
    expect(body).toEqual({ success: true, data: [{ vsId: VS, shotCount: 4 }] });
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
  it('404 for a malformed id without touching the repo', async () => {
    expect((await DELETE(req('DELETE'), ctx('bad'))).status).toBe(404);
    expect(repo.remove).not.toHaveBeenCalled();
  });
});
