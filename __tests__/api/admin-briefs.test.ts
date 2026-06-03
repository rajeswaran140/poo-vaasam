/** @jest-environment node */
/**
 * Tests for /api/admin/briefs (+ /[id]) — admin gate, validation, save (201),
 * list, and fetch-one (404). BriefRepository is mocked.
 */

import { NextRequest } from 'next/server';

jest.mock('@/lib/auth-helper', () => ({
  ...jest.requireActual('@/lib/auth-helper'),
  requireAdmin: jest.fn(),
}));

const mockSave = jest.fn();
const mockList = jest.fn();
const mockFindById = jest.fn();
jest.mock('@/infrastructure/database/BriefRepository', () => ({
  BriefRepository: jest.fn().mockImplementation(() => ({
    save: mockSave,
    list: mockList,
    findById: mockFindById,
  })),
}));

import { POST, GET } from '@/app/api/admin/briefs/route';
import { GET as GET_ONE } from '@/app/api/admin/briefs/[id]/route';
import * as auth from '@/lib/auth-helper';

const mockedRequireAdmin = auth.requireAdmin as jest.Mock;

const analysis = { emotion: 'அன்னை', suno_prompts: [{ style: 'Traditional Tamil', prompt: 'p' }] };

const post = (body: unknown) =>
  new NextRequest('https://tamilagaval.com/api/admin/briefs', { method: 'POST', body: JSON.stringify(body) });
const getReq = (url = 'https://tamilagaval.com/api/admin/briefs') =>
  new NextRequest(url, { method: 'GET' });

beforeEach(() => {
  jest.clearAllMocks();
  mockedRequireAdmin.mockResolvedValue({ isAuthenticated: true });
});

it('POST returns 403 when caller is not admin (and does not save)', async () => {
  const { AuthError } = jest.requireActual('@/lib/auth-helper');
  mockedRequireAdmin.mockRejectedValueOnce(new AuthError('Forbidden', 403));
  const res = await POST(post({ lyrics: 'l', analysis }));
  expect(res.status).toBe(403);
  expect(mockSave).not.toHaveBeenCalled();
});

it('POST returns 400 on invalid payload (missing analysis)', async () => {
  const res = await POST(post({ lyrics: 'l' }));
  expect(res.status).toBe(400);
  expect(mockSave).not.toHaveBeenCalled();
});

it('POST saves and returns 201 with the brief', async () => {
  mockSave.mockResolvedValueOnce({ id: 'brief_1', decision: { chosenSunoStyle: 'Traditional Tamil' } });
  const res = await POST(post({ lyrics: 'அரிதான', analysis, decision: { chosenSunoStyle: 'Traditional Tamil' } }));
  expect(res.status).toBe(201);
  const body = await res.json();
  expect(body.success).toBe(true);
  expect(body.data.id).toBe('brief_1');
  expect(mockSave).toHaveBeenCalledWith(
    expect.objectContaining({ lyrics: 'அரிதான', decision: { chosenSunoStyle: 'Traditional Tamil' } })
  );
});

it('GET lists briefs (clamps limit) and returns 200', async () => {
  mockList.mockResolvedValueOnce([{ id: 'brief_2' }, { id: 'brief_1' }]);
  const res = await GET(getReq('https://tamilagaval.com/api/admin/briefs?limit=5'));
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.data).toHaveLength(2);
  expect(mockList).toHaveBeenCalledWith({ limit: 5 });
});

it('GET /[id] returns 404 when the brief is missing', async () => {
  mockFindById.mockResolvedValueOnce(null);
  const res = await GET_ONE(getReq('https://tamilagaval.com/api/admin/briefs/nope'), { params: Promise.resolve({ id: 'nope' }) });
  expect(res.status).toBe(404);
});

it('GET /[id] returns the brief when found', async () => {
  mockFindById.mockResolvedValueOnce({ id: 'brief_9', analysis });
  const res = await GET_ONE(getReq('https://tamilagaval.com/api/admin/briefs/brief_9'), { params: Promise.resolve({ id: 'brief_9' }) });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.data.id).toBe('brief_9');
});
