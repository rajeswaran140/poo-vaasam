/** @jest-environment node */
/**
 * /api/admin/generations — POST (log) + GET (list). Admin-gated. Proves auth
 * short-circuits, body validation, the brief-must-exist 404, and both list paths.
 */

import { NextRequest } from 'next/server';

jest.mock('@/lib/auth-helper', () => ({
  ...jest.requireActual('@/lib/auth-helper'),
  requireAdmin: jest.fn(),
}));

const mockFindById = jest.fn();
jest.mock('@/infrastructure/database/BriefRepository', () => ({
  BriefRepository: jest.fn().mockImplementation(() => ({ findById: mockFindById })),
}));

const mockCreate = jest.fn();
const mockListByBrief = jest.fn();
const mockList = jest.fn();
jest.mock('@/infrastructure/database/GenerationRepository', () => ({
  GenerationRepository: jest.fn().mockImplementation(() => ({
    create: mockCreate,
    listByBrief: mockListByBrief,
    list: mockList,
  })),
}));

import { POST, GET } from '@/app/api/admin/generations/route';
import * as auth from '@/lib/auth-helper';

const mockedRequireAdmin = auth.requireAdmin as jest.Mock;
const postReq = (body: unknown) =>
  new NextRequest('https://tamilagaval.com/api/admin/generations', { method: 'POST', body: JSON.stringify(body) });
const getReq = (qs = '') =>
  new NextRequest(`https://tamilagaval.com/api/admin/generations${qs}`);

const validBody = { briefId: 'brief_1', verdict: 'failed', scores: { melody: 8 }, notes: 'flute good' };

beforeEach(() => {
  jest.clearAllMocks();
  mockedRequireAdmin.mockResolvedValue({ isAuthenticated: true, userId: 'admin-1' });
  mockFindById.mockResolvedValue({ id: 'brief_1' });
  mockCreate.mockResolvedValue({ id: 'gen_1', briefId: 'brief_1', verdict: 'failed' });
});

describe('POST', () => {
  it('returns 403 for a non-admin and never touches the DB', async () => {
    const { AuthError } = jest.requireActual('@/lib/auth-helper');
    mockedRequireAdmin.mockRejectedValueOnce(new AuthError('Forbidden', 403));
    const res = await POST(postReq(validBody));
    expect(res.status).toBe(403);
    expect(mockFindById).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('returns 400 on an invalid payload (success + failureReason)', async () => {
    const res = await POST(postReq({ briefId: 'b', verdict: 'success', failureReason: 'mixing' }));
    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('returns 404 when the referenced brief does not exist', async () => {
    mockFindById.mockResolvedValueOnce(null);
    const res = await POST(postReq(validBody));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('Brief not found');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('creates the generation and returns 201 + the record', async () => {
    const res = await POST(postReq(validBody));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.id).toBe('gen_1');
    // It persisted the validated (defaulted) payload.
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ briefId: 'brief_1', engine: 'suno', verdict: 'failed' }));
  });

  it('returns 502 without leaking detail when the repo throws', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    mockCreate.mockRejectedValueOnce(new Error('ddb boom'));
    const res = await POST(postReq(validBody));
    expect(res.status).toBe(502);
    expect((await res.json()).error).not.toMatch(/ddb boom/);
  });
});

describe('GET', () => {
  it('returns 401 when unauthenticated', async () => {
    const { AuthError } = jest.requireActual('@/lib/auth-helper');
    mockedRequireAdmin.mockRejectedValueOnce(new AuthError('Unauthorized', 401));
    expect((await GET(getReq())).status).toBe(401);
  });

  it('lists a single brief\'s attempts when ?briefId is given', async () => {
    mockListByBrief.mockResolvedValueOnce([{ id: 'gen_1' }]);
    const res = await GET(getReq('?briefId=brief_1'));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, data: [{ id: 'gen_1' }] });
    expect(mockListByBrief).toHaveBeenCalledWith('brief_1');
    expect(mockList).not.toHaveBeenCalled();
  });

  it('falls back to the all-feed (capped limit) without a briefId', async () => {
    mockList.mockResolvedValueOnce([]);
    await GET(getReq('?limit=9999'));
    expect(mockList).toHaveBeenCalledWith({ limit: 200 }); // capped at 200
    expect(mockListByBrief).not.toHaveBeenCalled();
  });
});
