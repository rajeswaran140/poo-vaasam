/** @jest-environment node */
/** POST /api/admin/deploy — admin-gated Amplify RELEASE trigger. */

import { NextRequest } from 'next/server';

jest.mock('@/lib/auth-helper', () => ({
  ...jest.requireActual('@/lib/auth-helper'),
  requireAdmin: jest.fn(),
}));
const mockTrigger = jest.fn();
jest.mock('@/lib/amplify-deploy', () => ({ triggerRelease: (...a: unknown[]) => mockTrigger(...a) }));

import { POST } from '@/app/api/admin/deploy/route';
import * as auth from '@/lib/auth-helper';

const req = () => new NextRequest('https://tamilagaval.com/api/admin/deploy', { method: 'POST' });

beforeEach(() => {
  jest.clearAllMocks();
  (auth.requireAdmin as jest.Mock).mockResolvedValue({ isAuthenticated: true });
  mockTrigger.mockResolvedValue({ ok: true, jobId: '181' });
  process.env.AMPLIFY_APP_ID = 'd3rkmepk4popv0';
});
afterEach(() => {
  delete process.env.AMPLIFY_APP_ID;
});

it('403s for a non-admin', async () => {
  const { AuthError } = jest.requireActual('@/lib/auth-helper');
  (auth.requireAdmin as jest.Mock).mockRejectedValueOnce(new AuthError('Forbidden', 403));
  expect((await POST(req())).status).toBe(403);
  expect(mockTrigger).not.toHaveBeenCalled();
});

it('202s with the jobId on success', async () => {
  const res = await POST(req());
  expect(res.status).toBe(202);
  expect((await res.json()).jobId).toBe('181');
  expect(mockTrigger).toHaveBeenCalledWith('d3rkmepk4popv0', 'master');
});

it('503s when AMPLIFY_APP_ID is not configured', async () => {
  delete process.env.AMPLIFY_APP_ID;
  expect((await POST(req())).status).toBe(503);
  expect(mockTrigger).not.toHaveBeenCalled();
});

it('502s when the StartJob call fails', async () => {
  mockTrigger.mockResolvedValueOnce({ ok: false, error: 'AccessDenied' });
  expect((await POST(req())).status).toBe(502);
});
