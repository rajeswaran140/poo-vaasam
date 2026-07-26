/** @jest-environment node */
/**
 * Tests for PATCH /api/admin/songs/[id]/theme — auth gate, body validation,
 * happy path SET, clear-via-empty-string REMOVE, and the row-not-found
 * ConditionalCheckFailedException → 404 mapping.
 */

import { NextRequest } from 'next/server';

jest.mock('@aws-sdk/client-dynamodb', () => {
  const send = jest.fn();
  return {
    __send: send,
    DynamoDBClient: jest.fn(() => ({ send })),
    UpdateItemCommand: jest.fn((input) => ({ __cmd: 'Update', input })),
  };
});

jest.mock('@/lib/auth-helper', () => ({
  ...jest.requireActual('@/lib/auth-helper'),
  requireAdmin: jest.fn(),
}));

jest.mock('@/lib/aws-config', () => ({
  awsConfig: { region: 'ca-central-1' },
  dynamoDBConfig: { tableName: 'TamilWebContent' },
}));

import { PATCH } from '@/app/api/admin/songs/[id]/theme/route';
import * as auth from '@/lib/auth-helper';

const mockSend = (jest.requireMock('@aws-sdk/client-dynamodb') as any).__send as jest.Mock;
const mockedRequireAdmin = auth.requireAdmin as jest.Mock;

const req = (id: string, body: unknown, withBearer = true) =>
  new NextRequest(`https://tamilagaval.com/api/admin/songs/${id}/theme`, {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: withBearer ? { Authorization: 'Bearer test-token' } : undefined,
  });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  jest.clearAllMocks();
  mockSend.mockReset();
  mockedRequireAdmin.mockResolvedValue({ isAuthenticated: true, email: 'admin@example.com' });
});

it('rejects with 403 when caller is not admin', async () => {
  const { AuthError } = jest.requireActual('@/lib/auth-helper');
  mockedRequireAdmin.mockRejectedValueOnce(new AuthError('Forbidden', 403));
  const res = await PATCH(req('cnt_1', { theme: 'love' }), params('cnt_1'));
  expect(res.status).toBe(403);
  expect(mockSend).not.toHaveBeenCalled();
});

it('rejects with 401 without a Bearer token (CSRF defense on the mutation)', async () => {
  const res = await PATCH(req('cnt_1', { theme: 'love' }, false), params('cnt_1'));
  expect(res.status).toBe(401);
  expect(mockSend).not.toHaveBeenCalled();
});

it('rejects malformed content id with 400', async () => {
  const res = await PATCH(req('not-a-cnt-id', { theme: 'love' }), params('not-a-cnt-id'));
  expect(res.status).toBe(400);
  expect(mockSend).not.toHaveBeenCalled();
});

it('rejects unknown themes with 400', async () => {
  const res = await PATCH(req('cnt_abc', { theme: 'rave' }), params('cnt_abc'));
  expect(res.status).toBe(400);
  expect(mockSend).not.toHaveBeenCalled();
});

it('SETs the theme on the row when valid', async () => {
  mockSend.mockResolvedValueOnce({});
  const res = await PATCH(req('cnt_abc', { theme: 'homeland' }), params('cnt_abc'));
  expect(res.status).toBe(200);
  const cmd = mockSend.mock.calls[0]?.[0]?.input;
  expect(cmd.UpdateExpression).toMatch(/SET theme = :t/);
  expect(cmd.ExpressionAttributeValues[':t']).toEqual({ S: 'homeland' });
  expect(cmd.ConditionExpression).toMatch(/attribute_exists/);
});

it('REMOVEs the theme when body is empty string (clears override)', async () => {
  mockSend.mockResolvedValueOnce({});
  const res = await PATCH(req('cnt_abc', { theme: '' }), params('cnt_abc'));
  expect(res.status).toBe(200);
  const cmd = mockSend.mock.calls[0]?.[0]?.input;
  expect(cmd.UpdateExpression).toMatch(/REMOVE theme/);
});

it('returns 404 when the song row does not exist', async () => {
  const err = Object.assign(new Error('cond'), { name: 'ConditionalCheckFailedException' });
  mockSend.mockRejectedValueOnce(err);
  const res = await PATCH(req('cnt_missing', { theme: 'love' }), params('cnt_missing'));
  expect(res.status).toBe(404);
});

it('returns 500 on other DynamoDB errors', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  mockSend.mockRejectedValueOnce(new Error('throttled'));
  const res = await PATCH(req('cnt_abc', { theme: 'love' }), params('cnt_abc'));
  expect(res.status).toBe(500);
});
