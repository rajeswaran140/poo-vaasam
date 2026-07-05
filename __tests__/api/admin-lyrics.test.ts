/** @jest-environment node */
/**
 * Tests for /api/admin/lyrics — admin gate on GET, Bearer-required + reserved-word
 * aliased update on PATCH (showLyrics / body), and 404 for a missing song.
 * DynamoDB + auth are mocked.
 */

import { NextRequest } from 'next/server';

jest.mock('@/lib/auth-helper', () => ({
  ...jest.requireActual('@/lib/auth-helper'),
  requireAdmin: jest.fn(),
}));

const mockQuery = jest.fn();
const mockUpdate = jest.fn();
const mockGet = jest.fn();
jest.mock('@/infrastructure/database/dynamodb-client', () => ({
  DynamoDBOperations: {
    query: (...a: unknown[]) => mockQuery(...a),
    update: (...a: unknown[]) => mockUpdate(...a),
    get: (...a: unknown[]) => mockGet(...a),
  },
}));

import { GET, PATCH } from '@/app/api/admin/lyrics/route';
import * as auth from '@/lib/auth-helper';

const requireAdmin = auth.requireAdmin as jest.Mock;

const SONGS = [
  { id: 'cnt_1', title: 'ஒன்று', titleSlug: 'ondru', body: 'வரி', status: 'PUBLISHED', type: 'SONGS', showLyrics: true },
  { id: 'cnt_2', title: 'இரண்டு', titleSlug: 'irandu', status: 'PUBLISHED', type: 'SONGS' },
];

beforeEach(() => {
  requireAdmin.mockReset().mockResolvedValue({ userId: 'admin', isAuthenticated: true });
  mockQuery.mockReset().mockResolvedValue({ Items: SONGS, LastEvaluatedKey: undefined });
  mockUpdate.mockReset().mockResolvedValue({});
  mockGet.mockReset();
});

// A request WITH a Bearer token (needed for PATCH's requireBearer).
const authedReq = (init: RequestInit = {}) =>
  new NextRequest('http://localhost/api/admin/lyrics', {
    ...init,
    headers: { ...(init.headers || {}), authorization: 'Bearer test-token' },
  });

describe('GET /api/admin/lyrics', () => {
  it('401s when not an admin', async () => {
    requireAdmin.mockRejectedValue(new auth.AuthError('Unauthorized', 401));
    const res = await GET(new NextRequest('http://localhost/api/admin/lyrics'));
    expect(res.status).toBe(401);
  });

  it('lists songs with hasBody/showLyrics flags', async () => {
    const res = await GET(new NextRequest('http://localhost/api/admin/lyrics'));
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.total).toBe(2);
    expect(json.data[0]).toEqual({
      id: 'cnt_1', title: 'ஒன்று', titleSlug: 'ondru', hasBody: true, showLyrics: true, status: 'PUBLISHED',
    });
    expect(json.data[1].hasBody).toBe(false);
    expect(json.data[1].showLyrics).toBe(false);
  });

  it('returns one song WITH its body when ?id= is passed (for the editor)', async () => {
    mockGet.mockResolvedValueOnce({ id: 'cnt_1', title: 'ஒன்று', titleSlug: 'ondru', body: 'வரி ஒன்று', status: 'PUBLISHED', showLyrics: true });
    const res = await GET(new NextRequest('http://localhost/api/admin/lyrics?id=cnt_1'));
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.song).toEqual({
      id: 'cnt_1', title: 'ஒன்று', titleSlug: 'ondru', body: 'வரி ஒன்று', showLyrics: true, status: 'PUBLISHED',
    });
    expect(mockGet).toHaveBeenCalledWith({ PK: 'CONTENT#cnt_1', SK: 'METADATA' });
  });

  it('404s for ?id= of a missing song', async () => {
    mockGet.mockResolvedValueOnce(undefined);
    const res = await GET(new NextRequest('http://localhost/api/admin/lyrics?id=ghost'));
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/admin/lyrics', () => {
  it('401s when not an admin', async () => {
    requireAdmin.mockRejectedValue(new auth.AuthError('Unauthorized', 401));
    const res = await PATCH(authedReq({ method: 'PATCH', body: JSON.stringify({ id: 'cnt_1', showLyrics: true }) }));
    expect(res.status).toBe(401);
  });

  it('401s when no Bearer token is present (CSRF guard)', async () => {
    const res = await PATCH(
      new NextRequest('http://localhost/api/admin/lyrics', {
        method: 'PATCH',
        body: JSON.stringify({ id: 'cnt_1', showLyrics: true }),
      })
    );
    expect(res.status).toBe(401);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('validates the body (nothing to update → 400)', async () => {
    const res = await PATCH(authedReq({ method: 'PATCH', body: JSON.stringify({ id: 'cnt_1' }) }));
    expect(res.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('toggles showLyrics with an attribute-name alias + updatedAt', async () => {
    const res = await PATCH(authedReq({ method: 'PATCH', body: JSON.stringify({ id: 'cnt_1', showLyrics: true }) }));
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
    const args = mockUpdate.mock.calls[0][0];
    expect(args.key).toEqual({ PK: 'CONTENT#cnt_1', SK: 'METADATA' });
    expect(args.expressionAttributeNames['#showLyrics']).toBe('showLyrics');
    expect(args.expressionAttributeValues[':showLyrics']).toBe(true);
    expect(args.expressionAttributeNames['#updatedAt']).toBe('updatedAt');
    expect(args.conditionExpression).toBe('attribute_exists(PK)');
  });

  it('updates the lyrics body via the reserved-word #body alias', async () => {
    const res = await PATCH(authedReq({ method: 'PATCH', body: JSON.stringify({ id: 'cnt_1', body: 'புதிய வரிகள்' }) }));
    expect(res.status).toBe(200);
    const args = mockUpdate.mock.calls[0][0];
    expect(args.expressionAttributeNames['#body']).toBe('body');
    expect(args.expressionAttributeValues[':body']).toBe('புதிய வரிகள்');
    expect(args.updateExpression).toContain('#body = :body');
  });

  it('404s when the song does not exist', async () => {
    mockUpdate.mockRejectedValue(Object.assign(new Error('cond'), { name: 'ConditionalCheckFailedException' }));
    const res = await PATCH(authedReq({ method: 'PATCH', body: JSON.stringify({ id: 'ghost', showLyrics: true }) }));
    expect(res.status).toBe(404);
  });
});
