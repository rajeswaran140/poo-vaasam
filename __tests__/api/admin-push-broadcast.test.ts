/** @jest-environment node */
import { NextRequest } from 'next/server';

jest.mock('@/lib/auth-helper', () => ({
  ...jest.requireActual('@/lib/auth-helper'),
  requireAdmin: jest.fn(),
}));
jest.mock('@/lib/push-broadcast', () => ({
  isVapidConfigured: jest.fn(() => true),
  broadcastPush: jest.fn(),
}));
jest.mock('@/lib/push-store', () => ({
  ...jest.requireActual('@/lib/push-store'),
  countPushSubscriptions: jest.fn(),
}));

import { GET, POST } from '@/app/api/admin/push/broadcast/route';
import * as auth from '@/lib/auth-helper';
import * as bc from '@/lib/push-broadcast';
import * as store from '@/lib/push-store';

const mockAdmin = auth.requireAdmin as jest.Mock;
const mockVapid = bc.isVapidConfigured as jest.Mock;
const mockBroadcast = bc.broadcastPush as jest.Mock;
const mockCount = store.countPushSubscriptions as jest.Mock;

const get = () => GET(new NextRequest(new Request('http://localhost/api/admin/push/broadcast')));
const post = (body: unknown) =>
  POST(new NextRequest(new Request('http://localhost/api/admin/push/broadcast', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  })));

beforeEach(() => {
  mockAdmin.mockReset().mockResolvedValue({ isAuthenticated: true });
  mockVapid.mockReset().mockReturnValue(true);
  mockBroadcast.mockReset();
  mockCount.mockReset();
});

it('401s a non-admin on both GET and POST', async () => {
  const { AuthError } = jest.requireActual('@/lib/auth-helper');
  mockAdmin.mockRejectedValue(new AuthError('Unauthorized', 401));
  expect((await get()).status).toBe(401);
  expect((await post({ title: 'a', body: 'b' })).status).toBe(401);
  expect(mockBroadcast).not.toHaveBeenCalled();
});

it('503s when VAPID is not configured', async () => {
  mockVapid.mockReturnValue(false);
  expect((await get()).status).toBe(503);
  expect((await post({ title: 'a', body: 'b' })).status).toBe(503);
});

it('GET returns the subscriber count', async () => {
  mockCount.mockResolvedValueOnce(7);
  const res = await get();
  expect(res.status).toBe(200);
  expect((await res.json()).subscribers).toBe(7);
});

it('POST broadcasts and returns the tally', async () => {
  mockBroadcast.mockResolvedValueOnce({ total: 5, sent: 4, pruned: 1, failed: 0 });
  const res = await post({ title: 'New song', body: 'Listen now', url: '/songs' });
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ success: true, sent: 4, pruned: 1 });
  expect(mockBroadcast).toHaveBeenCalledWith({ title: 'New song', body: 'Listen now', url: '/songs' });
});

it('POST 400 when title/body missing', async () => {
  const res = await post({ title: '' });
  expect(res.status).toBe(400);
  expect(mockBroadcast).not.toHaveBeenCalled();
});
