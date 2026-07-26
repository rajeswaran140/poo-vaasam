/** @jest-environment node */
/**
 * Tests for /api/admin/subscribers — admin gate, date-range + status filtering
 * on GET, and admin-driven unsubscribe/resubscribe on PATCH. DynamoDB is mocked.
 */

import { NextRequest } from 'next/server';

jest.mock('@/lib/auth-helper', () => ({
  ...jest.requireActual('@/lib/auth-helper'),
  requireAdmin: jest.fn(),
}));

const mockScanAll = jest.fn();
const mockUpdate = jest.fn();
jest.mock('@/infrastructure/database/dynamodb-client', () => ({
  DynamoDBOperations: {
    scanAll: (...a: unknown[]) => mockScanAll(...a),
    update: (...a: unknown[]) => mockUpdate(...a),
  },
}));

import { GET, PATCH } from '@/app/api/admin/subscribers/route';
import * as auth from '@/lib/auth-helper';

const requireAdmin = auth.requireAdmin as jest.Mock;

const ITEMS = [
  { PK: 'SUBSCRIBER#a@x.com', email: 'a@x.com', source: 'site', status: 'SUBSCRIBED', createdAt: '2026-06-01T10:00:00Z' },
  { PK: 'SUBSCRIBER#b@x.com', email: 'b@x.com', source: 'footer', status: 'UNSUBSCRIBED', createdAt: '2026-06-10T10:00:00Z', unsubscribedAt: '2026-06-12T00:00:00Z' },
  { PK: 'SUBSCRIBER#c@x.com', email: 'c@x.com', source: 'site', status: 'SUBSCRIBED', createdAt: '2026-06-20T10:00:00Z' },
];

beforeEach(() => {
  requireAdmin.mockReset().mockResolvedValue({ userId: 'admin', isAdmin: true });
  mockScanAll.mockReset().mockResolvedValue({ Items: ITEMS, truncated: false });
  mockUpdate.mockReset();
});

const getReq = (qs = '') => new NextRequest(`http://localhost/api/admin/subscribers${qs}`);

describe('GET /api/admin/subscribers', () => {
  it('401s when not an admin', async () => {
    requireAdmin.mockRejectedValue(new auth.AuthError('Unauthorized', 401));
    const res = await GET(getReq());
    expect(res.status).toBe(401);
  });

  it('returns all subscribers + summary (filters absent)', async () => {
    const res = await GET(getReq());
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.total).toBe(3);
    expect(json.summary).toEqual({ subscribed: 2, unsubscribed: 1, total: 3 });
    // newest-first
    expect(json.data.map((s: { email: string }) => s.email)).toEqual(['c@x.com', 'b@x.com', 'a@x.com']);
  });

  it('filters by join-date range (inclusive)', async () => {
    const res = await GET(getReq('?from=2026-06-05&to=2026-06-15'));
    const json = await res.json();
    expect(json.data.map((s: { email: string }) => s.email)).toEqual(['b@x.com']);
    // summary still reflects ALL subscribers, not the filtered view
    expect(json.summary.total).toBe(3);
  });

  it('filters by status=unsubscribed and reports daily counts', async () => {
    const res = await GET(getReq('?status=unsubscribed'));
    const json = await res.json();
    expect(json.data.map((s: { email: string }) => s.email)).toEqual(['b@x.com']);
    expect(json.daily).toContainEqual({ date: '2026-06-12', unsubscribes: 1, signups: 0 });
  });

  it('ignores a malformed date param (treats as no bound)', async () => {
    const res = await GET(getReq('?from=not-a-date'));
    const json = await res.json();
    expect(json.total).toBe(3);
  });

  it('reads the FULL list via scanAll (no silent 1MB truncation) and surfaces truncated', async () => {
    const res = await GET(getReq());
    const json = await res.json();
    expect(mockScanAll).toHaveBeenCalledTimes(1); // paginated helper, not a single scan
    expect(json.truncated).toBe(false);

    mockScanAll.mockResolvedValueOnce({ Items: ITEMS, truncated: true });
    const res2 = await GET(getReq());
    expect((await res2.json()).truncated).toBe(true);
  });
});

describe('PATCH /api/admin/subscribers', () => {
  const patchReq = (body: unknown, withBearer = true) =>
    new NextRequest('http://localhost/api/admin/subscribers', {
      method: 'PATCH',
      body: JSON.stringify(body),
      headers: withBearer ? { Authorization: 'Bearer test-token' } : undefined,
    });

  it('401s when not an admin', async () => {
    requireAdmin.mockRejectedValue(new auth.AuthError('Unauthorized', 401));
    const res = await PATCH(patchReq({ email: 'a@x.com', action: 'unsubscribe' }));
    expect(res.status).toBe(401);
  });

  it('401s without a Bearer token (CSRF defense on the mutation)', async () => {
    const res = await PATCH(patchReq({ email: 'a@x.com', action: 'unsubscribe' }, false));
    expect(res.status).toBe(401);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('validates the body', async () => {
    const res = await PATCH(patchReq({ email: 'not-an-email', action: 'unsubscribe' }));
    expect(res.status).toBe(400);
  });

  it('processes an unsubscribe (sets status via the #s reserved-word alias)', async () => {
    mockUpdate.mockResolvedValue({ email: 'a@x.com', status: 'UNSUBSCRIBED', unsubscribedAt: '2026-06-20T00:00:00Z', createdAt: '2026-06-01T10:00:00Z' });
    const res = await PATCH(patchReq({ email: 'A@x.com', action: 'unsubscribe' }));
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.status).toBe('UNSUBSCRIBED');
    const args = mockUpdate.mock.calls[0][0];
    expect(args.key).toEqual({ PK: 'SUBSCRIBER#a@x.com', SK: 'METADATA' }); // email lower-cased
    expect(args.expressionAttributeNames).toEqual({ '#s': 'status' });
    expect(args.expressionAttributeValues[':s']).toBe('UNSUBSCRIBED');
    expect(args.conditionExpression).toBe('attribute_exists(PK)');
  });

  it('re-subscribes (REMOVEs unsubscribedAt)', async () => {
    mockUpdate.mockResolvedValue({ email: 'b@x.com', status: 'SUBSCRIBED', createdAt: '2026-06-10T10:00:00Z' });
    const res = await PATCH(patchReq({ email: 'b@x.com', action: 'resubscribe' }));
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(mockUpdate.mock.calls[0][0].updateExpression).toContain('REMOVE unsubscribedAt');
  });

  it('404s when the subscriber does not exist', async () => {
    mockUpdate.mockRejectedValue(Object.assign(new Error('cond'), { name: 'ConditionalCheckFailedException' }));
    const res = await PATCH(patchReq({ email: 'ghost@x.com', action: 'unsubscribe' }));
    expect(res.status).toBe(404);
  });
});
