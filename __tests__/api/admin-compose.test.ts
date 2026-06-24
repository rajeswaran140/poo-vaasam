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
import { __resetComposeRateLimitForTests } from '@/lib/compose-rate-limit';
import { InvokeCommand } from '@aws-sdk/client-lambda';
import * as auth from '@/lib/auth-helper';

const MockInvoke = InvokeCommand as unknown as jest.Mock;

const mockedRequireAdmin = auth.requireAdmin as jest.Mock;
const req = (body: unknown) =>
  new NextRequest('https://tamilagaval.com/api/admin/compose', { method: 'POST', body: JSON.stringify(body) });

beforeEach(() => {
  jest.clearAllMocks();
  __resetComposeRateLimitForTests(); // isolate the per-user limiter between cases
  mockedRequireAdmin.mockResolvedValue({ isAuthenticated: true, userId: 'admin-1' });
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

describe('rate limiting (per admin)', () => {
  it('throttles after the per-minute cap, returning 429 without invoking the worker', async () => {
    // The limit is 10/min; exhaust it, then the 11th call must be rejected.
    for (let i = 0; i < 10; i++) {
      const ok = await POST(req({ lyrics: `காதல் ${i}` }));
      expect(ok.status).toBe(202);
    }
    mockCreate.mockClear();
    mockSend.mockClear();

    const limited = await POST(req({ lyrics: 'one too many' }));
    expect(limited.status).toBe(429);
    const body = await limited.json();
    expect(body.success).toBe(false);
    expect(limited.headers.get('Retry-After')).toBeTruthy();
    // A throttled request must not create a job or spend a Lambda/Sonnet call.
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('meters each admin independently (one admin maxed out does not block another)', async () => {
    mockedRequireAdmin.mockResolvedValue({ isAuthenticated: true, userId: 'admin-A' });
    for (let i = 0; i < 10; i++) {
      expect((await POST(req({ lyrics: `a${i}` }))).status).toBe(202);
    }
    expect((await POST(req({ lyrics: 'over' }))).status).toBe(429);

    // A different admin still has a full budget.
    mockedRequireAdmin.mockResolvedValue({ isAuthenticated: true, userId: 'admin-B' });
    expect((await POST(req({ lyrics: 'fresh' }))).status).toBe(202);
  });

  it('does NOT consume rate-limit budget when the caller is not an admin', async () => {
    const { AuthError } = jest.requireActual('@/lib/auth-helper');
    mockedRequireAdmin.mockRejectedValue(new AuthError('Forbidden', 403));
    // Many forbidden attempts...
    for (let i = 0; i < 20; i++) {
      expect((await POST(req({ lyrics: 'x' }))).status).toBe(403);
    }
    // ...then a real admin still composes (budget was never touched).
    mockedRequireAdmin.mockResolvedValue({ isAuthenticated: true, userId: 'admin-1' });
    expect((await POST(req({ lyrics: 'real' }))).status).toBe(202);
  });
});
