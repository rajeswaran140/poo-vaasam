/** @jest-environment node */
/**
 * /api/admin/music-lab routes — measure (sync invoke measure-fn), master
 * (enqueue + Event-invoke master-worker), and status. Admin-gated; Lambda + repo
 * mocked. The route never spawns ffmpeg.
 */

import { NextRequest } from 'next/server';

jest.mock('@/lib/auth-helper', () => ({
  ...jest.requireActual('@/lib/auth-helper'),
  requireAdmin: jest.fn(),
}));

const mockSend = jest.fn();
jest.mock('@aws-sdk/client-lambda', () => ({
  LambdaClient: jest.fn().mockImplementation(() => ({ send: mockSend })),
  InvokeCommand: jest.fn().mockImplementation((input) => ({ input })),
}));

const mockCreate = jest.fn();
const mockGet = jest.fn();
jest.mock('@/infrastructure/database/MasterJobRepository', () => ({
  MasterJobRepository: jest.fn().mockImplementation(() => ({ create: mockCreate, get: mockGet })),
}));

import { POST as measurePOST } from '@/app/api/admin/music-lab/measure/route';
import { POST as masterPOST } from '@/app/api/admin/music-lab/master/route';
import { GET as statusGET } from '@/app/api/admin/music-lab/master/[jobId]/route';
import { InvokeCommand } from '@aws-sdk/client-lambda';
import * as auth from '@/lib/auth-helper';

const requireAdmin = auth.requireAdmin as jest.Mock;
const MockInvoke = InvokeCommand as unknown as jest.Mock;
const post = (path: string, body: unknown) => new NextRequest(`https://tamilagaval.com${path}`, { method: 'POST', body: JSON.stringify(body) });

beforeEach(() => {
  jest.clearAllMocks();
  requireAdmin.mockResolvedValue({ isAuthenticated: true, userId: 'admin-1' });
  mockSend.mockResolvedValue({});
  mockCreate.mockResolvedValue({});
});

describe('measure', () => {
  it('403s for a non-admin', async () => {
    const { AuthError } = jest.requireActual('@/lib/auth-helper');
    requireAdmin.mockRejectedValueOnce(new AuthError('Forbidden', 403));
    expect((await measurePOST(post('/api/admin/music-lab/measure', { s3Key: 'a.mp3' }))).status).toBe(403);
  });

  it('400s on a bad / traversal key', async () => {
    expect((await measurePOST(post('/api/admin/music-lab/measure', { s3Key: '' }))).status).toBe(400);
    expect((await measurePOST(post('/api/admin/music-lab/measure', { s3Key: '../secret' }))).status).toBe(400);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('returns the measure-fn result (sync RequestResponse invoke)', async () => {
    const payload = { metrics: { lufs: -11, lra: 4, truePeak: -0.5, crest: 8, flatFactor: 0 }, badge: '+3 LU hot', verdict: 'clip-risk' };
    mockSend.mockResolvedValueOnce({ Payload: Buffer.from(JSON.stringify(payload)) });
    const res = await measurePOST(post('/api/admin/music-lab/measure', { s3Key: 'audio/take.mp3' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ success: true, badge: '+3 LU hot', verdict: 'clip-risk' });
    expect(MockInvoke.mock.calls[0][0].InvocationType).toBe('RequestResponse');
  });

  it('502s when measure-fn returns a FunctionError', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    mockSend.mockResolvedValueOnce({ FunctionError: 'Unhandled', Payload: Buffer.from('{"error":"boom"}') });
    expect((await measurePOST(post('/api/admin/music-lab/measure', { s3Key: 'a.mp3' }))).status).toBe(502);
  });
});

describe('master enqueue', () => {
  it('creates a job and Event-invokes the worker (202)', async () => {
    const res = await masterPOST(post('/api/admin/music-lab/master', { s3Key: 'audio/take.mp3' }));
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.status).toBe('queued');
    expect(body.jobId).toBeTruthy();
    expect(mockCreate).toHaveBeenCalledWith(body.jobId, { s3Key: 'audio/take.mp3', target: -14 });
    expect(MockInvoke.mock.calls[0][0].InvocationType).toBe('Event');
  });

  it('400s on a bad key (no job, no invoke)', async () => {
    expect((await masterPOST(post('/api/admin/music-lab/master', { s3Key: '../x' }))).status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('400s rather than silently defaulting when target is unusable', async () => {
    // A string target used to fall through to -14: asking for Apple's -16 and
    // quietly getting -14 is the failure this guards.
    for (const target of ['-16', -100, 0, NaN, null]) {
      const res = await masterPOST(post('/api/admin/music-lab/master', { s3Key: 'audio/take.wav', target }));
      expect(res.status).toBe(400);
    }
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('honours a valid non-default target', async () => {
    const res = await masterPOST(post('/api/admin/music-lab/master', { s3Key: 'audio/take.wav', target: -16 }));
    expect(res.status).toBe(202);
    expect(mockCreate).toHaveBeenCalledWith(expect.any(String), { s3Key: 'audio/take.wav', target: -16 });
  });

  it('400s on re-mastering a mastering output', async () => {
    for (const s3Key of ['audio/take-master-14LUFS.wav', 'audio/take.mp3-master.wav']) {
      expect((await masterPOST(post('/api/admin/music-lab/master', { s3Key }))).status).toBe(400);
    }
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });
});

describe('master status', () => {
  const ctx = (jobId: string) => ({ params: Promise.resolve({ jobId }) });
  it('404s on an unknown job', async () => {
    mockGet.mockResolvedValueOnce(null);
    expect((await statusGET(new NextRequest('https://x/api/admin/music-lab/master/j1'), ctx('j1'))).status).toBe(404);
  });
  it('returns the job when found', async () => {
    mockGet.mockResolvedValueOnce({
      id: 'j1', status: 'done', masterKey: 'audio/take-master-14LUFS.wav',
      beforeLufs: -8, afterLufs: -14, afterTp: -1, target: -14,
    });
    const res = await statusGET(new NextRequest('https://x/api/admin/music-lab/master/j1'), ctx('j1'));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      success: true, status: 'done', masterKey: 'audio/take-master-14LUFS.wav', afterLufs: -14,
    });
  });
});
