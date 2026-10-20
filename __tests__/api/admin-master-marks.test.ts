/** @jest-environment node */
jest.mock('@/lib/auth-helper', () => ({
  requireAdmin: jest.fn().mockResolvedValue({}), requireBearer: jest.fn(),
  authErrorResponse: jest.fn(() => new Response('no', { status: 401 })),
}));
const masterGet = jest.fn();
jest.mock('@/infrastructure/database/MasterJobRepository', () => ({
  MasterJobRepository: jest.fn().mockImplementation(() => ({ get: masterGet })),
}));
const list = jest.fn(); const get = jest.fn(); const create = jest.fn(); const update = jest.fn(); const del = jest.fn();
jest.mock('@/infrastructure/database/MarkRepository', () => {
  class StaleMarkError extends Error { constructor() { super('stale'); this.name = 'StaleMarkError'; } }
  return {
    StaleMarkError,
    MarkRepository: jest.fn().mockImplementation(() => ({ list, get, create, update, delete: del })),
  };
});

import { GET, POST } from '@/app/api/admin/music-lab/master/[jobId]/marks/route';
import { PATCH, DELETE } from '@/app/api/admin/music-lab/master/[jobId]/marks/[markId]/route';
import { StaleMarkError } from '@/infrastructure/database/MarkRepository';
import { requireAdmin } from '@/lib/auth-helper';

const JOB = '0b5e2c1a-1111-4222-8333-444455556666';
const SAVED = { id: JOB, status: 'done', savedAt: '2026-10-01T00:00:00.000Z', editedDurationSec: null, source: { durationSec: 300 } };
const MARK = { markId: 'm1', masterJobId: JOB, start: 102, end: null, reason: 'pronunciation', note: '', status: 'open', fixedIn: null, version: 1, createdAt: 't', updatedAt: 't' };
const req = (method: string, body?: unknown) =>
  new Request('http://x', { method, ...(body ? { body: JSON.stringify(body) } : {}) }) as never;
const p = (markId?: string) => ({ params: Promise.resolve({ jobId: JOB, ...(markId ? { markId } : {}) }) });

beforeEach(() => {
  jest.clearAllMocks();
  masterGet.mockResolvedValue(SAVED);
  list.mockResolvedValue([MARK]);
  get.mockResolvedValue(MARK);
  create.mockResolvedValue(MARK);
  update.mockResolvedValue({ ...MARK, version: 2 });
  del.mockResolvedValue(undefined);
});

it('is admin-only', async () => {
  (requireAdmin as jest.Mock).mockRejectedValueOnce(new Error('no'));
  expect((await GET(req('GET'), p())).status).toBe(401);
});

it('lists a saved master\'s marks', async () => {
  const res = await GET(req('GET'), p());
  expect(await res.json()).toEqual({ success: true, marks: [MARK] });
});

it('404s an unknown master and 409s an unsaved one', async () => {
  masterGet.mockResolvedValueOnce(null);
  expect((await POST(req('POST', { start: 1, reason: 'melody' }), p())).status).toBe(404);
  masterGet.mockResolvedValueOnce({ ...SAVED, savedAt: null });
  const res = await POST(req('POST', { start: 1, reason: 'melody' }), p());
  expect(res.status).toBe(409);
  expect((await res.json()).code).toBe('not-saved');
  expect(create).not.toHaveBeenCalled();
});

it('creates a mark bounded by the master\'s duration', async () => {
  expect((await POST(req('POST', { start: 102, reason: 'pronunciation' }), p())).status).toBe(201);
  expect(create).toHaveBeenCalledWith(JOB, { start: 102, end: null, reason: 'pronunciation', note: '' });
  expect((await POST(req('POST', { start: 400, reason: 'melody' }), p())).status).toBe(400);
});

it('refuses the 501st mark', async () => {
  list.mockResolvedValueOnce(Array.from({ length: 500 }, (_, i) => ({ ...MARK, markId: `m${i}` })));
  const res = await POST(req('POST', { start: 1, reason: 'melody' }), p());
  expect(res.status).toBe(409);
  expect((await res.json()).code).toBe('too-many');
});

it('updates with the version the client saw', async () => {
  const res = await PATCH(req('PATCH', { version: 1, status: 'wont-fix' }), p('m1'));
  expect(res.status).toBe(200);
  expect(update).toHaveBeenCalledWith(JOB, 'm1', 1, { status: 'wont-fix' });
});

it('409s a stale edit, and of two edits on the same version one wins', async () => {
  update.mockResolvedValueOnce({ ...MARK, version: 2 }).mockRejectedValueOnce(new StaleMarkError());
  const [a, b] = await Promise.all([
    PATCH(req('PATCH', { version: 1, note: 'one' }), p('m1')),
    PATCH(req('PATCH', { version: 1, note: 'two' }), p('m1')),
  ]);
  expect([a.status, b.status].sort()).toEqual([200, 409]);
  const loser = a.status === 409 ? a : b;
  expect((await loser.json()).code).toBe('stale');
});

it('credits a fix only to a saved child of this master', async () => {
  masterGet.mockImplementation(async (id: string) =>
    id === JOB ? SAVED
    : id === 'child1' ? { id, savedAt: 't', derivedFrom: { jobId: JOB, via: 're-master' } }
    : id === 'stranger' ? { id, savedAt: 't', derivedFrom: { jobId: 'someone-else', via: 're-master' } }
    : null);
  expect((await PATCH(req('PATCH', { version: 1, status: 'fixed', fixedIn: 'child1' }), p('m1'))).status).toBe(200);
  const res = await PATCH(req('PATCH', { version: 1, status: 'fixed', fixedIn: 'stranger' }), p('m1'));
  expect(res.status).toBe(400);
  expect((await res.json()).code).toBe('bad-fixed-in');
});

it('404s a missing mark on PATCH and DELETE', async () => {
  get.mockResolvedValue(null);
  expect((await PATCH(req('PATCH', { version: 1, note: 'x' }), p('nope'))).status).toBe(404);
  expect((await DELETE(req('DELETE'), p('nope'))).status).toBe(404);
  expect(del).not.toHaveBeenCalled();
});

it('deletes a mark', async () => {
  expect((await DELETE(req('DELETE'), p('m1'))).status).toBe(200);
  expect(del).toHaveBeenCalledWith(JOB, 'm1');
});
