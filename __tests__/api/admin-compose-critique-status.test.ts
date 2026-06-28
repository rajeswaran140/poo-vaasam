/** @jest-environment node */
/**
 * Tests for GET /api/admin/compose/critique/[jobId] — the critic poll endpoint.
 * Admin-gated; returns job status (+ result/error), 404 when unknown.
 */

import { NextRequest } from 'next/server';

jest.mock('@/lib/auth-helper', () => ({
  ...jest.requireActual('@/lib/auth-helper'),
  requireAdmin: jest.fn(),
}));

const mockGet = jest.fn();
jest.mock('@/infrastructure/database/CriticJobRepository', () => ({
  CriticJobRepository: jest.fn().mockImplementation(() => ({ get: mockGet })),
}));

import { GET } from '@/app/api/admin/compose/critique/[jobId]/route';
import * as auth from '@/lib/auth-helper';

const requireAdmin = auth.requireAdmin as jest.Mock;
const get = (id: string) =>
  GET(new NextRequest(`https://tamilagaval.com/api/admin/compose/critique/${id}`), { params: Promise.resolve({ jobId: id }) });

beforeEach(() => {
  jest.clearAllMocks();
  requireAdmin.mockResolvedValue({ isAuthenticated: true });
});

it('returns 403 when not admin', async () => {
  const { AuthError } = jest.requireActual('@/lib/auth-helper');
  requireAdmin.mockRejectedValueOnce(new AuthError('Forbidden', 403));
  expect((await get('critic_1')).status).toBe(403);
  expect(mockGet).not.toHaveBeenCalled();
});

it('returns 404 for an unknown job', async () => {
  mockGet.mockResolvedValueOnce(null);
  expect((await get('nope')).status).toBe(404);
});

it('reports a processing job', async () => {
  mockGet.mockResolvedValueOnce({ id: 'critic_1', status: 'processing', result: null, error: null });
  const body = await (await get('critic_1')).json();
  expect(body).toMatchObject({ success: true, status: 'processing', result: null });
});

it('returns the critique when done', async () => {
  mockGet.mockResolvedValueOnce({ id: 'critic_1', status: 'done', result: { overall: 'tender read', strengths: [], observations: [], slackLines: [], wordIdeas: [], questions: [] }, error: null });
  const body = await (await get('critic_1')).json();
  expect(body.status).toBe('done');
  expect(body.result.overall).toBe('tender read');
});

it('surfaces a structured error', async () => {
  mockGet.mockResolvedValueOnce({ id: 'critic_1', status: 'error', result: null, error: { code: 'bad_response', message: 'Try again' } });
  const body = await (await get('critic_1')).json();
  expect(body.status).toBe('error');
  expect(body.error.code).toBe('bad_response');
});
