/** @jest-environment node */
/**
 * POST /api/admin/music-lab/master/[jobId]/save + GET /api/admin/music-lab/masters
 * — the saved-masters library. Saving is what makes a master durable (it strips
 * the 24h ttl), so the guards around it matter more than the happy path.
 */
import { NextRequest } from 'next/server';

jest.mock('@/lib/auth-helper', () => ({
  ...jest.requireActual('@/lib/auth-helper'),
  requireAdmin: jest.fn(),
}));

const mockGet = jest.fn();
const mockSave = jest.fn();
const mockListSaved = jest.fn();
jest.mock('@/infrastructure/database/MasterJobRepository', () => ({
  MasterJobRepository: jest.fn().mockImplementation(() => ({
    get: mockGet, save: mockSave, listSaved: mockListSaved,
  })),
}));

import { POST } from '@/app/api/admin/music-lab/master/[jobId]/save/route';
import { GET } from '@/app/api/admin/music-lab/masters/route';
import * as auth from '@/lib/auth-helper';

const BEARER = { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' };
const saveReq = (body: unknown, withBearer = true) =>
  new NextRequest('https://tamilagaval.com/api/admin/music-lab/master/j1/save', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: withBearer ? BEARER : { 'Content-Type': 'application/json' },
  });
const ctx = (jobId = 'j1') => ({ params: Promise.resolve({ jobId }) });
const doneJob = { id: 'j1', status: 'done', masterKey: 'audio/mastering/x-master-14LUFS.wav' };

beforeEach(() => {
  jest.clearAllMocks();
  (auth.requireAdmin as jest.Mock).mockResolvedValue({ isAuthenticated: true });
  mockGet.mockResolvedValue(doneJob);
  mockListSaved.mockResolvedValue([]);
});

it('403s a non-admin', async () => {
  const { AuthError } = jest.requireActual('@/lib/auth-helper');
  (auth.requireAdmin as jest.Mock).mockRejectedValueOnce(new AuthError('Forbidden', 403));
  expect((await POST(saveReq({ title: 'x' }), ctx())).status).toBe(403);
  expect(mockSave).not.toHaveBeenCalled();
});

it('401s without a Bearer token (CSRF defense on the mutation)', async () => {
  expect((await POST(saveReq({ title: 'x' }, false), ctx())).status).toBe(401);
  expect(mockSave).not.toHaveBeenCalled();
});

/**
 * The important guard. Saving strips the ttl, so saving a job that is still
 * processing — or that failed — would leak an unfinished record into the table
 * permanently, and surface a library row with no WAV behind it.
 */
it('refuses to save a job that is not done', async () => {
  for (const status of ['processing', 'error']) {
    mockGet.mockResolvedValueOnce({ ...doneJob, status });
    const res = await POST(saveReq({ title: 'x' }), ctx());
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(new RegExp(status));
  }
  expect(mockSave).not.toHaveBeenCalled();
});

it('404s an unknown job', async () => {
  mockGet.mockResolvedValueOnce(null);
  expect((await POST(saveReq({ title: 'x' }), ctx())).status).toBe(404);
  expect(mockSave).not.toHaveBeenCalled();
});

it('saves with a sanitised title', async () => {
  const res = await POST(saveReq({ title: '  அம்மம்மா என் அகமே  ' }), ctx());
  expect(res.status).toBe(200);
  expect(mockSave).toHaveBeenCalledTimes(1);
  const [id, title] = mockSave.mock.calls[0];
  expect(id).toBe('j1');
  expect(title).toBeTruthy();
});

it('accepts an empty body — an untitled master is still worth keeping', async () => {
  const res = await POST(saveReq({}), ctx());
  expect(res.status).toBe(200);
  expect(mockSave).toHaveBeenCalledWith('j1', null);
});

it('rejects an over-long title rather than truncating it silently', async () => {
  const res = await POST(saveReq({ title: 'x'.repeat(200) }), ctx());
  expect(res.status).toBe(400);
  expect(mockSave).not.toHaveBeenCalled();
});

describe('GET /masters', () => {
  const listReq = (qs = '') =>
    new NextRequest(`https://tamilagaval.com/api/admin/music-lab/masters${qs}`);

  it('403s a non-admin', async () => {
    const { AuthError } = jest.requireActual('@/lib/auth-helper');
    (auth.requireAdmin as jest.Mock).mockRejectedValueOnce(new AuthError('Forbidden', 403));
    expect((await GET(listReq())).status).toBe(403);
  });

  it('returns the saved masters', async () => {
    mockListSaved.mockResolvedValueOnce([{ id: 'j1', title: 'A' }, { id: 'j2', title: 'B' }]);
    const body = await (await GET(listReq())).json();
    expect(body.success).toBe(true);
    expect(body.count).toBe(2);
  });

  it('caps limit so a crafted query cannot ask for the whole table', async () => {
    await GET(listReq('?limit=99999'));
    expect(mockListSaved).toHaveBeenCalledWith(200);
  });

  it('falls back to the default limit on junk input', async () => {
    await GET(listReq('?limit=abc'));
    expect(mockListSaved).toHaveBeenCalledWith(100);
  });
});
