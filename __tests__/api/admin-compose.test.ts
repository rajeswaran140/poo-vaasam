/** @jest-environment node */
/**
 * Tests for POST /api/admin/compose — the async enqueue route. Admin-gated.
 * It creates a `processing` job and fire-and-forget invokes the worker Lambda,
 * returning the job id (202). Auth (401/403) and body-validation (400) short out.
 */

import { NextRequest } from 'next/server';

jest.mock('@/lib/auth-helper', () => ({
  ...jest.requireActual('@/lib/auth-helper'),
  requireAdmin: jest.fn(),
}));

const mockCreate = jest.fn();
jest.mock('@/infrastructure/database/ComposeJobRepository', () => ({
  ComposeJobRepository: jest.fn().mockImplementation(() => ({ create: mockCreate })),
}));

const mockSend = jest.fn();
jest.mock('@aws-sdk/client-lambda', () => ({
  LambdaClient: jest.fn().mockImplementation(() => ({ send: mockSend })),
  InvokeCommand: jest.fn().mockImplementation((input) => ({ input })),
}));

import { POST } from '@/app/api/admin/compose/route';
import { InvokeCommand } from '@aws-sdk/client-lambda';
import * as auth from '@/lib/auth-helper';

const MockInvoke = InvokeCommand as unknown as jest.Mock;

const mockedRequireAdmin = auth.requireAdmin as jest.Mock;
const req = (body: unknown) =>
  new NextRequest('https://tamilagaval.com/api/admin/compose', { method: 'POST', body: JSON.stringify(body) });

beforeEach(() => {
  jest.clearAllMocks();
  mockedRequireAdmin.mockResolvedValue({ isAuthenticated: true });
  mockCreate.mockResolvedValue({ id: 'compose_x', status: 'processing' });
  mockSend.mockResolvedValue({ StatusCode: 202 });
});

it('returns 403 when caller is not admin (no job created)', async () => {
  const { AuthError } = jest.requireActual('@/lib/auth-helper');
  mockedRequireAdmin.mockRejectedValueOnce(new AuthError('Forbidden', 403));
  const res = await POST(req({ lyrics: 'காதல்' }));
  expect(res.status).toBe(403);
  expect(mockCreate).not.toHaveBeenCalled();
  expect(mockSend).not.toHaveBeenCalled();
});

it('returns 400 when lyrics are missing', async () => {
  const res = await POST(req({}));
  expect(res.status).toBe(400);
  expect(mockCreate).not.toHaveBeenCalled();
});

it('returns 400 when lyrics are too long', async () => {
  const res = await POST(req({ lyrics: 'x'.repeat(8001) }));
  expect(res.status).toBe(400);
});

it('surfaces the SPECIFIC validation message, not a generic one', async () => {
  expect((await (await POST(req({ lyrics: 'x'.repeat(8001) }))).json()).error).toBe('Lyrics too long');
  expect((await (await POST(req({ lyrics: '' }))).json()).error).toBe('Lyrics required');
});

it('enqueues a job and async-invokes the worker, returning 202 + jobId', async () => {
  const res = await POST(req({ lyrics: 'காதல் வரிகள்' }));
  expect(res.status).toBe(202);
  const body = await res.json();
  expect(body.success).toBe(true);
  expect(body.jobId).toMatch(/^compose_/);
  expect(body.status).toBe('processing');

  // A processing job is created with the same id...
  expect(mockCreate).toHaveBeenCalledWith(body.jobId);
  // ...and the worker is invoked async (Event) with { jobId, lyrics }.
  expect(mockSend).toHaveBeenCalledTimes(1);
  const cmdInput = MockInvoke.mock.calls[0][0] as { InvocationType: string; FunctionName: string; Payload: Uint8Array };
  expect(cmdInput.InvocationType).toBe('Event');
  expect(cmdInput.FunctionName).toBe('tamilagaval-compose-worker');
  const payload = JSON.parse(Buffer.from(cmdInput.Payload).toString());
  expect(payload).toEqual({ jobId: body.jobId, lyrics: 'காதல் வரிகள்' });
});

it('returns 502 when the worker invoke fails', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  mockSend.mockRejectedValueOnce(new Error('lambda unavailable'));
  const res = await POST(req({ lyrics: 'lyrics' }));
  expect(res.status).toBe(502);
  const body = await res.json();
  expect(body.success).toBe(false);
  expect(body.error).not.toMatch(/lambda unavailable/); // raw detail not leaked
});
