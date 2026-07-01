/** @jest-environment node */
/**
 * Tests for GET /api/admin/compose/[jobId] — the poll endpoint. Admin-gated;
 * returns the job status (+ result/error), 404 when unknown.
 */

import { NextRequest } from 'next/server';

jest.mock('@/lib/auth-helper', () => ({
  ...jest.requireActual('@/lib/auth-helper'),
  requireAdmin: jest.fn(),
}));

const mockGet = jest.fn();
jest.mock('@/infrastructure/database/ComposeJobRepository', () => ({
  ComposeJobRepository: jest.fn().mockImplementation(() => ({ get: mockGet })),
}));

import { GET } from '@/app/api/admin/compose/[jobId]/route';
import * as auth from '@/lib/auth-helper';

const mockedRequireAdmin = auth.requireAdmin as jest.Mock;
const get = (id: string) =>
  GET(new NextRequest(`https://tamilagaval.com/api/admin/compose/${id}`), { params: Promise.resolve({ jobId: id }) });

beforeEach(() => {
  jest.clearAllMocks();
  mockedRequireAdmin.mockResolvedValue({ isAuthenticated: true });
});

it('returns 403 when not admin', async () => {
  const { AuthError } = jest.requireActual('@/lib/auth-helper');
  mockedRequireAdmin.mockRejectedValueOnce(new AuthError('Forbidden', 403));
  const res = await get('compose_1_a1');
  expect(res.status).toBe(403);
  expect(mockGet).not.toHaveBeenCalled();
});

it('returns 400 for a malformed job id (no DB read)', async () => {
  const res = await get('nope');
  expect(res.status).toBe(400);
  expect(mockGet).not.toHaveBeenCalled();
});

it('returns 404 for an unknown job', async () => {
  mockGet.mockResolvedValueOnce(null);
  const res = await get('compose_9_zzz');
  expect(res.status).toBe(404);
});

it('reports a stalled processing job as a timeout error', async () => {
  mockGet.mockResolvedValueOnce({
    id: 'compose_1_a1',
    status: 'processing',
    createdAt: '2020-01-01T00:00:00.000Z', // long past the worker budget
    result: null,
    error: null,
  });
  const res = await get('compose_1_a1');
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.status).toBe('error');
  expect(body.error.code).toBe('upstream');
});

it('reports a processing job', async () => {
  mockGet.mockResolvedValueOnce({ id: 'compose_1_a1', status: 'processing', result: null, error: null });
  const res = await get('compose_1_a1');
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body).toMatchObject({ success: true, status: 'processing', result: null });
});

it('returns the brief when done', async () => {
  mockGet.mockResolvedValueOnce({ id: 'compose_1_a1', status: 'done', result: { emotion: 'காதல்' }, error: null });
  const res = await get('compose_1_a1');
  const body = await res.json();
  expect(body.status).toBe('done');
  expect(body.result.emotion).toBe('காதல்');
});

it('surfaces a structured error', async () => {
  mockGet.mockResolvedValueOnce({ id: 'compose_1_a1', status: 'error', result: null, error: { code: 'rate_limit', message: 'Try again' } });
  const res = await get('compose_1_a1');
  const body = await res.json();
  expect(body.status).toBe('error');
  expect(body.error.code).toBe('rate_limit');
});
