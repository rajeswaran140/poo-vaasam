/** @jest-environment node */
/**
 * Tests for /api/admin/stories — admin gate + Bearer CSRF guard on mutations,
 * the status counts on GET, status updates via the #s reserved-word alias, and
 * id-scheme validation on DELETE. DynamoDB is mocked.
 */

import { NextRequest } from 'next/server';

jest.mock('@/lib/auth-helper', () => ({
  ...jest.requireActual('@/lib/auth-helper'),
  requireAdmin: jest.fn(),
  requireBearer: jest.fn(),
}));

const mockScanAll = jest.fn();
const mockUpdate = jest.fn();
const mockDelete = jest.fn();
jest.mock('@/infrastructure/database/dynamodb-client', () => ({
  DynamoDBOperations: {
    scanAll: (...a: unknown[]) => mockScanAll(...a),
    update: (...a: unknown[]) => mockUpdate(...a),
    delete: (...a: unknown[]) => mockDelete(...a),
  },
}));

import { GET, PATCH, DELETE } from '@/app/api/admin/stories/route';
import * as auth from '@/lib/auth-helper';

const requireAdmin = auth.requireAdmin as jest.Mock;
const requireBearer = auth.requireBearer as jest.Mock;

const ITEMS = [
  { PK: 'STORY#story_1', SK: 'METADATA', id: 'story_1', name: 'A', theme: 'mother', story: 'a memory here', featureConsent: true, email: 'a@x.com', status: 'NEW', source: 'share-page', createdAt: '2026-07-01T10:00:00Z' },
  { PK: 'STORY#story_2', SK: 'METADATA', id: 'story_2', name: 'B', theme: 'homeland', story: 'another one here', featureConsent: false, status: 'FEATURED', source: 'share-page', createdAt: '2026-07-03T10:00:00Z' },
  { PK: 'STORY#story_3', SK: 'METADATA', id: 'story_3', name: 'C', theme: 'love', story: 'third memory here', featureConsent: false, status: 'NEW', source: 'share-page', createdAt: '2026-07-02T10:00:00Z' },
];

beforeEach(() => {
  jest.clearAllMocks();
  requireAdmin.mockResolvedValue({ isAuthenticated: true, userId: 'admin' });
  requireBearer.mockReturnValue(undefined); // bearer present by default
  mockScanAll.mockResolvedValue({ Items: ITEMS, truncated: false });
});

const getReq = () => new NextRequest('http://localhost/api/admin/stories');

describe('GET /api/admin/stories', () => {
  it('401s when not an admin', async () => {
    requireAdmin.mockRejectedValueOnce(new auth.AuthError('Unauthorized', 401));
    const res = await GET(getReq());
    expect(res.status).toBe(401);
  });

  it('returns all stories newest-first with status counts', async () => {
    const res = await GET(getReq());
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.total).toBe(3);
    expect(json.data.map((s: { id: string }) => s.id)).toEqual(['story_2', 'story_3', 'story_1']);
    expect(json.counts).toEqual({ NEW: 2, REVIEWED: 0, FEATURED: 1, ARCHIVED: 0 });
    expect(json.data[2].featureConsent).toBe(true);
  });

  it('reads the FULL list via scanAll and surfaces truncated', async () => {
    mockScanAll.mockResolvedValueOnce({ Items: ITEMS, truncated: true });
    const res = await GET(getReq());
    expect(mockScanAll).toHaveBeenCalledTimes(1);
    expect((await res.json()).truncated).toBe(true);
  });
});

describe('PATCH /api/admin/stories', () => {
  const patchReq = (body: unknown) =>
    new NextRequest('http://localhost/api/admin/stories', { method: 'PATCH', body: JSON.stringify(body) });

  it('401s when not an admin', async () => {
    requireAdmin.mockRejectedValueOnce(new auth.AuthError('Unauthorized', 401));
    const res = await PATCH(patchReq({ id: 'story_1', status: 'REVIEWED' }));
    expect(res.status).toBe(401);
  });

  it('401s (CSRF guard) when no Bearer token is presented', async () => {
    requireBearer.mockImplementationOnce(() => {
      throw new auth.AuthError('Bearer token required for this operation', 401);
    });
    const res = await PATCH(patchReq({ id: 'story_1', status: 'REVIEWED' }));
    expect(res.status).toBe(401);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('validates the body (unknown status → 400)', async () => {
    const res = await PATCH(patchReq({ id: 'story_1', status: 'BOGUS' }));
    expect(res.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('rejects a malformed id scheme (400)', async () => {
    const res = await PATCH(patchReq({ id: 'not-a-story', status: 'FEATURED' }));
    expect(res.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('sets the status via the #s reserved-word alias + updatedAt', async () => {
    mockUpdate.mockResolvedValue({ id: 'story_1', status: 'FEATURED', theme: 'mother', name: 'A', story: 'a memory here', source: 'share-page', createdAt: '2026-07-01T10:00:00Z' });
    const res = await PATCH(patchReq({ id: 'story_1', status: 'FEATURED' }));
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.status).toBe('FEATURED');
    const args = mockUpdate.mock.calls[0][0];
    expect(args.key).toEqual({ PK: 'STORY#story_1', SK: 'METADATA' });
    expect(args.expressionAttributeNames).toEqual({ '#s': 'status' });
    expect(args.expressionAttributeValues[':s']).toBe('FEATURED');
    expect(args.updateExpression).toContain('updatedAt');
    expect(args.conditionExpression).toBe('attribute_exists(PK)');
  });

  it('404s when the story does not exist', async () => {
    mockUpdate.mockRejectedValue(Object.assign(new Error('cond'), { name: 'ConditionalCheckFailedException' }));
    const res = await PATCH(patchReq({ id: 'story_9', status: 'ARCHIVED' }));
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/admin/stories', () => {
  const delReq = (qs = '') => new NextRequest(`http://localhost/api/admin/stories${qs}`, { method: 'DELETE' });

  it('401s (CSRF guard) when no Bearer token is presented, never deleting', async () => {
    requireBearer.mockImplementationOnce(() => {
      throw new auth.AuthError('Bearer token required for this operation', 401);
    });
    const res = await DELETE(delReq('?id=story_1'));
    expect(res.status).toBe(401);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('400s on a missing / malformed id (no silent no-op delete)', async () => {
    expect((await DELETE(delReq(''))).status).toBe(400);
    expect((await DELETE(delReq('?id=nope'))).status).toBe(400);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('deletes the addressed story and returns 200', async () => {
    mockDelete.mockResolvedValue({});
    const res = await DELETE(delReq('?id=story_2'));
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
    expect(mockDelete).toHaveBeenCalledWith({ PK: 'STORY#story_2', SK: 'METADATA' });
  });
});
