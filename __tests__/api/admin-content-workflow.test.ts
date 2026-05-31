/** @jest-environment node */
/**
 * Tests for PATCH /api/admin/content/[id]/workflow — admin gate, id +
 * payload validation, SET path, empty-string REMOVE, ConditionalCheck
 * → 404 mapping, generic DB error → 500.
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

import { PATCH } from '@/app/api/admin/content/[id]/workflow/route';
import * as auth from '@/lib/auth-helper';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockSend = (jest.requireMock('@aws-sdk/client-dynamodb') as any).__send as jest.Mock;
const mockedRequireAdmin = auth.requireAdmin as jest.Mock;

const req = (id: string, body: unknown) =>
  new NextRequest(`https://tamilagaval.com/api/admin/content/${id}/workflow`, {
    method: 'PATCH',
    body: JSON.stringify(body),
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
  const res = await PATCH(req('cnt_a', { state: 'draft' }), params('cnt_a'));
  expect(res.status).toBe(403);
  expect(mockSend).not.toHaveBeenCalled();
});

it('rejects malformed content id with 400', async () => {
  const res = await PATCH(req('not-an-id', { state: 'draft' }), params('not-an-id'));
  expect(res.status).toBe(400);
  expect(mockSend).not.toHaveBeenCalled();
});

it('rejects unknown workflow state with 400', async () => {
  const res = await PATCH(req('cnt_a', { state: 'invented' }), params('cnt_a'));
  expect(res.status).toBe(400);
  expect(mockSend).not.toHaveBeenCalled();
});

it('SETs the workflowState on the row when valid', async () => {
  mockSend.mockResolvedValueOnce({});
  const res = await PATCH(req('cnt_a', { state: 'midi_reviewed' }), params('cnt_a'));
  expect(res.status).toBe(200);
  const cmd = mockSend.mock.calls[0]?.[0]?.input;
  expect(cmd.UpdateExpression).toMatch(/SET workflowState = :s/);
  expect(cmd.ExpressionAttributeValues[':s']).toEqual({ S: 'midi_reviewed' });
  expect(cmd.ConditionExpression).toMatch(/attribute_exists/);
});

it('REMOVEs the workflowState when body is empty string', async () => {
  mockSend.mockResolvedValueOnce({});
  const res = await PATCH(req('cnt_a', { state: '' }), params('cnt_a'));
  expect(res.status).toBe(200);
  const cmd = mockSend.mock.calls[0]?.[0]?.input;
  expect(cmd.UpdateExpression).toMatch(/REMOVE workflowState/);
});

it('returns 404 when the row does not exist', async () => {
  const err = Object.assign(new Error('cond'), { name: 'ConditionalCheckFailedException' });
  mockSend.mockRejectedValueOnce(err);
  const res = await PATCH(req('cnt_missing', { state: 'draft' }), params('cnt_missing'));
  expect(res.status).toBe(404);
});

it('returns 500 on other DynamoDB errors', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  mockSend.mockRejectedValueOnce(new Error('throttled'));
  const res = await PATCH(req('cnt_a', { state: 'draft' }), params('cnt_a'));
  expect(res.status).toBe(500);
});
