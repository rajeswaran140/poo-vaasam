/** @jest-environment node */
/**
 * GET /api/performers/songs — performer gate + the performable-songs list.
 */

import { NextRequest } from 'next/server';

jest.mock('@/lib/auth-helper', () => ({
  ...jest.requireActual('@/lib/auth-helper'),
  requirePerformer: jest.fn(),
}));

jest.mock('@/lib/performer-songs', () => ({
  listPerformableSongs: jest.fn(),
}));

import { GET } from '@/app/api/performers/songs/route';
import * as auth from '@/lib/auth-helper';
import * as lib from '@/lib/performer-songs';

const requirePerformer = auth.requirePerformer as jest.Mock;
const listPerformableSongs = lib.listPerformableSongs as jest.Mock;
const req = () => new NextRequest('https://tamilagaval.com/api/performers/songs');

beforeEach(() => {
  jest.clearAllMocks();
  requirePerformer.mockResolvedValue({ isAuthenticated: true, emailVerified: true });
});

it('returns 401 when unauthenticated (does not query)', async () => {
  const { AuthError } = jest.requireActual('@/lib/auth-helper');
  requirePerformer.mockRejectedValueOnce(new AuthError('Unauthorized', 401));
  const res = await GET(req());
  expect(res.status).toBe(401);
  expect(listPerformableSongs).not.toHaveBeenCalled();
});

it('returns 403 when the email is not verified', async () => {
  const { AuthError } = jest.requireActual('@/lib/auth-helper');
  requirePerformer.mockRejectedValueOnce(new AuthError('Email not verified', 403));
  const res = await GET(req());
  expect(res.status).toBe(403);
});

it('returns the performable songs on the happy path', async () => {
  listPerformableSongs.mockResolvedValueOnce([
    { id: 'cnt_1', slug: 'amma', title: 'அம்மா', artist: 'இராஜ்', theme: 'mother', durationSeconds: 230 },
  ]);
  const res = await GET(req());
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.success).toBe(true);
  expect(body.total).toBe(1);
  expect(body.data[0].id).toBe('cnt_1');
  // The list contract must not carry gated fields.
  expect(body.data[0]).not.toHaveProperty('lyrics');
});

it('returns 500 when the data layer throws', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  listPerformableSongs.mockRejectedValueOnce(new Error('dynamo down'));
  const res = await GET(req());
  expect(res.status).toBe(500);
});
