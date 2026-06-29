/** @jest-environment node */
/**
 * Tests for POST /api/admin/compose/critique — the async enqueue route. Admin-gated.
 * It creates a `processing` critic job and fire-and-forget invokes the shared
 * worker Lambda with kind:'critique', returning the job id (202). Auth (403) and
 * body-validation (400) short out; per-admin rate limit applies.
 */

import { NextRequest } from 'next/server';

jest.mock('@/lib/auth-helper', () => ({
  ...jest.requireActual('@/lib/auth-helper'),
  requireAdmin: jest.fn(),
}));

const mockCreate = jest.fn();
jest.mock('@/infrastructure/database/CriticJobRepository', () => ({
  CriticJobRepository: jest.fn().mockImplementation(() => ({ create: mockCreate })),
}));

const mockFindAll = jest.fn();
jest.mock('@/infrastructure/database/LexiconRepository', () => ({
  LexiconRepository: jest.fn().mockImplementation(() => ({ findAll: mockFindAll })),
}));

const mockSend = jest.fn();
jest.mock('@aws-sdk/client-lambda', () => ({
  LambdaClient: jest.fn().mockImplementation(() => ({ send: mockSend })),
  InvokeCommand: jest.fn().mockImplementation((input) => ({ input })),
}));

import { POST } from '@/app/api/admin/compose/critique/route';
import { __resetLyricCriticRateLimitForTests } from '@/lib/lyric-critic-rate-limit';
import { InvokeCommand } from '@aws-sdk/client-lambda';
import * as auth from '@/lib/auth-helper';

const MockInvoke = InvokeCommand as unknown as jest.Mock;
const requireAdmin = auth.requireAdmin as jest.Mock;
const req = (body: unknown) =>
  new NextRequest('https://tamilagaval.com/api/admin/compose/critique', { method: 'POST', body: JSON.stringify(body) });

beforeEach(() => {
  jest.clearAllMocks();
  __resetLyricCriticRateLimitForTests();
  requireAdmin.mockResolvedValue({ isAuthenticated: true, userId: 'admin-1' });
  mockCreate.mockResolvedValue({ id: 'critic_x', status: 'processing' });
  mockSend.mockResolvedValue({ StatusCode: 202 });
  mockFindAll.mockResolvedValue([]); // no lexicon by default → payload unchanged
});

it('returns 403 for a non-admin (no job created, no worker invoked)', async () => {
  const { AuthError } = jest.requireActual('@/lib/auth-helper');
  requireAdmin.mockRejectedValueOnce(new AuthError('Forbidden', 403));
  expect((await POST(req({ lyrics: 'வரிகள்' }))).status).toBe(403);
  expect(mockCreate).not.toHaveBeenCalled();
  expect(mockSend).not.toHaveBeenCalled();
});

it('rejects empty lyrics with 400 — no job created', async () => {
  const res = await POST(req({ lyrics: '   ' }));
  expect(res.status).toBe(400);
  expect(mockCreate).not.toHaveBeenCalled();
});

it('rejects an oversized draft with 400', async () => {
  expect((await POST(req({ lyrics: 'அ'.repeat(8001) }))).status).toBe(400);
});

it('enqueues a critic job and async-invokes the worker with kind:critique (202 + jobId)', async () => {
  const res = await POST(req({ lyrics: 'பல்லவி\nஊருக்குப் போகணும்', focus: ['meter'], notes: 'carry?' }));
  expect(res.status).toBe(202);
  const body = await res.json();
  expect(body.success).toBe(true);
  expect(body.jobId).toMatch(/^critic_/);
  expect(body.status).toBe('processing');

  expect(mockCreate).toHaveBeenCalledWith(body.jobId);
  expect(mockSend).toHaveBeenCalledTimes(1);
  const cmd = MockInvoke.mock.calls[0][0] as { InvocationType: string; FunctionName: string; Payload: Uint8Array };
  expect(cmd.InvocationType).toBe('Event');
  expect(cmd.FunctionName).toBe('tamilagaval-compose-worker');
  const payload = JSON.parse(Buffer.from(cmd.Payload).toString());
  expect(payload).toEqual({ kind: 'critique', jobId: body.jobId, lyrics: 'பல்லவி\nஊருக்குப் போகணும்', focus: ['meter'], notes: 'carry?' });
});

it('forwards the poet’s lexicon hints to the worker (prefer their own words)', async () => {
  mockFindAll.mockResolvedValueOnce([
    { word: 'எழில்', gloss: 'beauty', register: 'sangam', usage: 'fresh', themes: [], archived: false },
  ]);
  const res = await POST(req({ lyrics: 'வரிகள்' }));
  expect(res.status).toBe(202);
  const payload = JSON.parse(Buffer.from((MockInvoke.mock.calls[0][0] as { Payload: Uint8Array }).Payload).toString());
  expect(payload.lexicon).toContain('எழில் — beauty [sangam]');
});

it('still enqueues when the lexicon read fails (best-effort, never blocks)', async () => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  mockFindAll.mockRejectedValueOnce(new Error('dynamo down'));
  const res = await POST(req({ lyrics: 'வரிகள்' }));
  expect(res.status).toBe(202);
  const payload = JSON.parse(Buffer.from((MockInvoke.mock.calls[0][0] as { Payload: Uint8Array }).Payload).toString());
  expect(payload).not.toHaveProperty('lexicon');
});

it('defaults focus to [] and omits notes when not given', async () => {
  const res = await POST(req({ lyrics: 'ஊருக்குப் போகணும்' }));
  expect(res.status).toBe(202);
  const payload = JSON.parse(Buffer.from((MockInvoke.mock.calls[0][0] as { Payload: Uint8Array }).Payload).toString());
  expect(payload.focus).toEqual([]);
  expect(payload).not.toHaveProperty('notes');
});

it('returns 502 when the worker invoke fails (raw detail not leaked)', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  mockSend.mockRejectedValueOnce(new Error('lambda boom'));
  const res = await POST(req({ lyrics: 'வரிகள்' }));
  expect(res.status).toBe(502);
  expect((await res.json()).error).not.toMatch(/lambda boom/);
});

it('enforces the per-admin rate limit (16th call in a window is 429, no worker spend)', async () => {
  for (let i = 0; i < 15; i++) expect((await POST(req({ lyrics: `வரி ${i}` }))).status).toBe(202);
  mockCreate.mockClear();
  mockSend.mockClear();
  const limited = await POST(req({ lyrics: 'one too many' }));
  expect(limited.status).toBe(429);
  expect(mockCreate).not.toHaveBeenCalled();
  expect(mockSend).not.toHaveBeenCalled();
});
