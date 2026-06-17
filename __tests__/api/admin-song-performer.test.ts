/** @jest-environment node */
/**
 * PUT /api/admin/songs/[id]/performer — admin gate, validation, 404, and the
 * happy path that writes the gated lyrics + backing-track key.
 */

import { NextRequest } from 'next/server';

jest.mock('@/lib/auth-helper', () => ({
  ...jest.requireActual('@/lib/auth-helper'),
  requireAdmin: jest.fn(),
}));

jest.mock('@/lib/performer-write', () => ({
  setPerformerAssets: jest.fn(),
}));

const mockFindById = jest.fn();
jest.mock('@/infrastructure/database/ContentRepository', () => ({
  ContentRepository: jest.fn().mockImplementation(() => ({ findById: mockFindById })),
}));

import { GET, PUT } from '@/app/api/admin/songs/[id]/performer/route';
import * as auth from '@/lib/auth-helper';
import * as write from '@/lib/performer-write';

const requireAdmin = auth.requireAdmin as jest.Mock;
const setPerformerAssets = write.setPerformerAssets as jest.Mock;

const req = (b: unknown = {}, id = 'cnt_1') =>
  new NextRequest(`https://tamilagaval.com/api/admin/songs/${id}/performer`, { method: 'PUT', body: JSON.stringify(b) });
const ctx = (id = 'cnt_1') => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  jest.clearAllMocks();
  requireAdmin.mockResolvedValue({ isAuthenticated: true });
});

it('returns 403 for a non-admin (no write)', async () => {
  const { AuthError } = jest.requireActual('@/lib/auth-helper');
  requireAdmin.mockRejectedValueOnce(new AuthError('Forbidden', 403));
  const res = await PUT(req({ lyrics: 'x' }), ctx());
  expect(res.status).toBe(403);
  expect(setPerformerAssets).not.toHaveBeenCalled();
});

it('rejects a malformed id with 400', async () => {
  const res = await PUT(req({ lyrics: 'x' }, 'bad id'), ctx('bad id'));
  expect(res.status).toBe(400);
  expect(setPerformerAssets).not.toHaveBeenCalled();
});

it('rejects an empty body (no fields) with 400', async () => {
  const res = await PUT(req({}), ctx());
  expect(res.status).toBe(400);
  expect(setPerformerAssets).not.toHaveBeenCalled();
});

it('maps a missing song (conditional check) to 404', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  setPerformerAssets.mockRejectedValueOnce(Object.assign(new Error('cc'), { name: 'ConditionalCheckFailedException' }));
  const res = await PUT(req({ lyrics: 'பல்லவி' }), ctx());
  expect(res.status).toBe(404);
});

it('writes lyrics + instrumental key on the happy path', async () => {
  setPerformerAssets.mockResolvedValueOnce(undefined);
  const res = await PUT(req({ lyrics: 'பல்லவி', instrumentalKey: 'performer-tracks/cnt_1.mp3', instrumentalDuration: 230 }), ctx());
  expect(res.status).toBe(200);
  expect(setPerformerAssets).toHaveBeenCalledWith('cnt_1', {
    lyrics: 'பல்லவி',
    instrumentalKey: 'performer-tracks/cnt_1.mp3',
    instrumentalDuration: 230,
  });
});

describe('GET (load current assets for the editor)', () => {
  it('returns 403 for a non-admin', async () => {
    const { AuthError } = jest.requireActual('@/lib/auth-helper');
    requireAdmin.mockRejectedValueOnce(new AuthError('Forbidden', 403));
    const res = await GET(req({}), ctx());
    expect(res.status).toBe(403);
    expect(mockFindById).not.toHaveBeenCalled();
  });

  it('returns 404 when the song is missing', async () => {
    mockFindById.mockResolvedValueOnce(null);
    const res = await GET(req({}), ctx());
    expect(res.status).toBe(404);
  });

  it('returns the current lyrics / key / duration', async () => {
    mockFindById.mockResolvedValueOnce({ lyrics: 'பல்லவி', instrumentalKey: 'performer-tracks/cnt_1.mp3', instrumentalDuration: 230 });
    const res = await GET(req({}), ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true, lyrics: 'பல்லவி', instrumentalKey: 'performer-tracks/cnt_1.mp3', instrumentalDuration: 230 });
  });

  it('defaults missing assets to empty/null', async () => {
    mockFindById.mockResolvedValueOnce({});
    const res = await GET(req({}), ctx());
    const body = await res.json();
    expect(body).toEqual({ success: true, lyrics: '', instrumentalKey: '', instrumentalDuration: null });
  });
});
