/** @jest-environment node */
/**
 * PUT /api/admin/music-lab/master/[jobId]/slides — the slideshow's image list,
 * saved on the master.
 *
 * WHY IT EXISTS. The added images lived only in the open page, so a reload —
 * including every reload a deploy asks for — emptied the list and each image
 * had to be uploaded again. The list is now part of the master.
 *
 * The rules that matter: every image must be in the mastering workspace (the
 * worker's role can read the whole bucket, and this list is later sent to it),
 * the list is REPLACED not merged, and an empty list clears it.
 */

import { NextRequest } from 'next/server';

jest.mock('@/lib/auth-helper', () => ({
  ...jest.requireActual('@/lib/auth-helper'),
  requireAdmin: jest.fn(),
  requireBearer: jest.fn(),
}));

const get = jest.fn();
const setSlides = jest.fn();
jest.mock('@/infrastructure/database/MasterJobRepository', () => ({
  MasterJobRepository: jest.fn().mockImplementation(() => ({ get, setSlides })),
}));

import { PUT } from '@/app/api/admin/music-lab/master/[jobId]/slides/route';
import { requireAdmin, requireBearer } from '@/lib/auth-helper';

const req = (body: unknown) =>
  new NextRequest('https://x/api/admin/music-lab/master/job1/slides', {
    method: 'PUT',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
const params = Promise.resolve({ jobId: 'job1' });
const SLIDE = { coverKey: 'audio/mastering/1_c_two.png', name: 'two.png', at: '2:00', auto: true };

beforeEach(() => {
  jest.clearAllMocks();
  (requireAdmin as jest.Mock).mockResolvedValue({ isAuthenticated: true });
  (requireBearer as jest.Mock).mockReturnValue(undefined);
  get.mockResolvedValue({ id: 'job1', status: 'done', savedAt: '2026-07-01T00:00:00.000Z' });
});

describe('saving the image list', () => {
  it('stores the list exactly as sent', async () => {
    const res = await PUT(req({ slides: [SLIDE, { ...SLIDE, coverKey: 'audio/mastering/1_c_three.png', name: 'three.png', at: '4:00', auto: false }] }), { params });
    expect(res.status).toBe(200);
    expect(setSlides).toHaveBeenCalledWith('job1', [
      SLIDE,
      { coverKey: 'audio/mastering/1_c_three.png', name: 'three.png', at: '4:00', auto: false },
    ]);
  });

  it('clears the list when sent an empty one', async () => {
    const res = await PUT(req({ slides: [] }), { params });
    expect(res.status).toBe(200);
    expect(setSlides).toHaveBeenCalledWith('job1', []);
  });

  it('refuses an image outside the mastering workspace', async () => {
    const res = await PUT(req({ slides: [{ ...SLIDE, coverKey: 'private/secret.png' }] }), { params });
    expect(res.status).toBe(400);
    expect(setSlides).not.toHaveBeenCalled();
  });

  it('refuses more images than a slideshow can hold', async () => {
    const res = await PUT(req({ slides: Array.from({ length: 8 }, () => SLIDE) }), { params });
    expect(res.status).toBe(400);
    expect(setSlides).not.toHaveBeenCalled();
  });

  it('404s an unknown master', async () => {
    get.mockResolvedValue(null);
    const res = await PUT(req({ slides: [SLIDE] }), { params });
    expect(res.status).toBe(404);
    expect(setSlides).not.toHaveBeenCalled();
  });

  it('is admin-only', async () => {
    (requireAdmin as jest.Mock).mockRejectedValue(new Error('Unauthorized'));
    const res = await PUT(req({ slides: [SLIDE] }), { params });
    expect([401, 403]).toContain(res.status);
    expect(setSlides).not.toHaveBeenCalled();
  });
});
