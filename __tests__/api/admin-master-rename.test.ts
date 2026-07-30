/** @jest-environment node */
/**
 * PATCH /api/admin/music-lab/master/[jobId]/rename
 *
 * The rules that matter: it must NOT touch savedAt (that is what `save` does
 * and why this endpoint exists separately), it must refuse an unsaved job, and
 * the stored title must be the SANITISED one, because the same string becomes
 * the download filename.
 */

import { NextRequest } from 'next/server';

jest.mock('@/lib/auth-helper', () => ({
  ...jest.requireActual('@/lib/auth-helper'),
  requireAdmin: jest.fn(),
  requireBearer: jest.fn(),
}));

const get = jest.fn();
const rename = jest.fn();
const save = jest.fn();
jest.mock('@/infrastructure/database/MasterJobRepository', () => ({
  MasterJobRepository: jest.fn().mockImplementation(() => ({ get, rename, save })),
}));

import { PATCH } from '@/app/api/admin/music-lab/master/[jobId]/rename/route';
import { requireAdmin, requireBearer } from '@/lib/auth-helper';

const savedJob = {
  id: 'job1',
  status: 'done',
  savedAt: '2026-07-01T00:00:00.000Z',
  title: 'Old name',
  masterKey: 'audio/mastering/x.wav',
};

const req = (body: unknown) =>
  new NextRequest('https://x/api/admin/music-lab/master/job1/rename', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });

const params = Promise.resolve({ jobId: 'job1' });

beforeEach(() => {
  jest.clearAllMocks();
  (requireAdmin as jest.Mock).mockResolvedValue({ isAuthenticated: true });
  (requireBearer as jest.Mock).mockReturnValue(undefined);
  get.mockResolvedValue(savedJob);
  rename.mockResolvedValue(undefined);
});

describe('happy path', () => {
  it('renames and returns the stored title', async () => {
    const res = await PATCH(req({ title: 'நெஞ்சக் கூட்டினிலே' }), { params });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(rename).toHaveBeenCalledWith('job1', body.title);
  });

  it('NEVER calls save — that would re-stamp savedAt and move the library date', async () => {
    await PATCH(req({ title: 'New name' }), { params });
    expect(save).not.toHaveBeenCalled();
  });

  it('stores the sanitised title, not the raw input', async () => {
    // The title also becomes the download filename, so the two must agree.
    const res = await PATCH(req({ title: '  a/b\\c:d  ' }), { params });
    const body = await res.json();
    expect(body.title).not.toContain('/');
    expect(body.title).not.toContain('\\');
    expect(rename).toHaveBeenCalledWith('job1', body.title);
  });
});

describe('refusals', () => {
  it('refuses an UNSAVED job rather than leaving a 24h record with a permanent name', async () => {
    get.mockResolvedValue({ ...savedJob, savedAt: null });
    const res = await PATCH(req({ title: 'x' }), { params });
    expect(res.status).toBe(409);
    expect(rename).not.toHaveBeenCalled();
  });

  it('404s an unknown job', async () => {
    get.mockResolvedValue(null);
    const res = await PATCH(req({ title: 'x' }), { params });
    expect(res.status).toBe(404);
    expect(rename).not.toHaveBeenCalled();
  });

  it('rejects a title with no usable characters instead of storing an empty name', async () => {
    const res = await PATCH(req({ title: '///' }), { params });
    expect(res.status).toBe(400);
    expect(rename).not.toHaveBeenCalled();
  });

  it('rejects a missing title', async () => {
    const res = await PATCH(req({}), { params });
    expect(res.status).toBe(400);
  });

  it('rejects an over-long title', async () => {
    const res = await PATCH(req({ title: 'a'.repeat(121) }), { params });
    expect(res.status).toBe(400);
  });
});

describe('auth', () => {
  it('requires an admin', async () => {
    (requireAdmin as jest.Mock).mockRejectedValue(
      Object.assign(new Error('Unauthorized'), { status: 401, name: 'AuthError' })
    );
    const res = await PATCH(req({ title: 'x' }), { params });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(rename).not.toHaveBeenCalled();
  });

  it('rejects cookie-only auth on this mutation', async () => {
    (requireBearer as jest.Mock).mockImplementation(() => {
      throw Object.assign(new Error('Bearer required'), { status: 401, name: 'AuthError' });
    });
    const res = await PATCH(req({ title: 'x' }), { params });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(rename).not.toHaveBeenCalled();
  });
});
