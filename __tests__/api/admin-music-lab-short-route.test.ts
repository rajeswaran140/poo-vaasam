/** @jest-environment node */
/**
 * POST /api/admin/music-lab/master/[jobId]/short — the vertical clip, the
 * whole-song vertical, and the slideshow added to both.
 *
 * The route had no tests before this. What matters is the event the worker
 * receives: a short with no slideshow must arrive in its ORIGINAL shape,
 * because worker deploys are manual and the running Lambda branches on which
 * fields are present.
 */

jest.mock('@/lib/auth-helper', () => ({
  requireAdmin: jest.fn().mockResolvedValue({ email: 'admin@test' }),
  requireBearer: jest.fn(),
  authErrorResponse: jest.fn((err: unknown) => new Response(String(err), { status: 401 })),
}));

const getMock = jest.fn();
jest.mock('@/infrastructure/database/MasterJobRepository', () => ({
  MasterJobRepository: jest.fn().mockImplementation(() => ({ get: getMock })),
}));

const lambdaSend = jest.fn().mockResolvedValue({});
jest.mock('@aws-sdk/client-lambda', () => ({
  LambdaClient: jest.fn().mockImplementation(() => ({ send: lambdaSend })),
  InvokeCommand: jest.fn((args: unknown) => ({ __command: 'Invoke', args })),
}));

jest.mock('@/lib/aws-config', () => ({
  awsConfig: { region: 'ca-central-1', credentials: undefined },
}));

import { POST } from '@/app/api/admin/music-lab/master/[jobId]/short/route';
import type { MasterJob } from '@/types/masterJob';

const AUDIO = 'audio/mastering/1_ab_take-master-14LUFS.wav';
const A = 'audio/mastering/1_cd_a.jpg';
const B = 'audio/mastering/1_cd_b.jpg';
const C = 'audio/mastering/1_cd_c.jpg';

const baseJob = {
  id: 'j1',
  status: 'done',
  createdAt: '2026-09-22T00:00:00.000Z',
  updatedAt: '2026-09-22T00:05:00.000Z',
  s3Key: 'audio/mastering/1_ab_take.wav',
  target: -14,
  edit: null, join: null, editedDurationSec: null,
  mp3Key: 'audio/mastering/1_ab_take-master-14LUFS.mp3',
  mp3Lufs: -14, mp3Tp: -3.5,
  masterKey: AUDIO,
  beforeLufs: -14.4, beforeTp: -3.6, afterLufs: -14, afterTp: -3.5,
  beforeLra: 3, afterLra: 3,
  normalizationType: 'linear',
  source: null,
  savedAt: '2026-09-22T00:06:00.000Z',
  title: 'அந்தி மேகமே',
  archivedAt: null, archiveKey: null, archiveError: null,
  publishedAt: null, publishKey: null, publishError: null,
  videoKey: null, videoRenderedAt: null, videoError: null, coverKey: null,
  error: null,
} as unknown as MasterJob;

beforeEach(() => {
  getMock.mockReset().mockResolvedValue(baseJob);
  lambdaSend.mockClear();
});

async function post(body: unknown) {
  const req = new Request('http://localhost/api/admin/music-lab/master/j1/short', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
  return POST(req as unknown as import('next/server').NextRequest, { params: Promise.resolve({ jobId: 'j1' }) });
}

/** The `render` object as the worker will receive it. */
const sentEvent = () => {
  const cmd = lambdaSend.mock.calls[0][0] as { args: { Payload: Buffer } };
  return JSON.parse(cmd.args.Payload.toString()).short;
};

const LIST = [
  { coverKey: A, startSec: 0 },
  { coverKey: B, startSec: 90 },
  { coverKey: C, startSec: 150 },
];

describe('a short with no slideshow still sends the old event', () => {
  it('carries no `covers` field at all', async () => {
    const res = await post({ coverKey: A });
    expect(res.status).toBe(202);
    expect(sentEvent()).toEqual({ audioKey: AUDIO, coverKey: A });
  });

  it('treats an empty list as no slideshow', async () => {
    await post({ coverKey: A, covers: [] });
    expect(sentEvent()).not.toHaveProperty('covers');
  });
});

describe('a vertical slideshow', () => {
  it('forwards the image list in SONG time, beside a chosen window', async () => {
    const res = await post({ coverKey: A, startSec: 120, seconds: 60, covers: LIST });
    expect(res.status).toBe(202);
    expect(sentEvent()).toEqual({ audioKey: AUDIO, coverKey: A, startSec: 120, seconds: 60, covers: LIST });
  });

  it('forwards it for the whole song too', async () => {
    await post({ coverKey: A, full: true, covers: LIST });
    expect(sentEvent()).toEqual({ audioKey: AUDIO, coverKey: A, full: true, covers: LIST });
  });

  it('does NOT refuse an image that starts after the clip — it is simply not shown', async () => {
    // The list is timed against the song. A 30s clip from 0:00 never reaches
    // image B, and that is not an error.
    const res = await post({ coverKey: A, startSec: 0, seconds: 30, covers: LIST });
    expect(res.status).toBe(202);
  });

  it('refuses a cover that is not the first image', async () => {
    const res = await post({ coverKey: B, covers: LIST });
    expect(res.status).toBe(400);
    expect(lambdaSend).not.toHaveBeenCalled();
  });

  it('refuses images out of order, with the planner\'s wording', async () => {
    const res = await post({ coverKey: A, covers: [LIST[0], LIST[2], LIST[1]] });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('increase') });
    expect(lambdaSend).not.toHaveBeenCalled();
  });

  it('applies the workspace guard to a later image', async () => {
    const res = await post({ coverKey: A, covers: [LIST[0], { coverKey: 'private/x.jpg', startSec: 90 }] });
    expect(res.status).toBe(409);
    expect(lambdaSend).not.toHaveBeenCalled();
  });
});

describe('a short that moves', () => {
  it('forwards a chosen move', async () => {
    const res = await post({ coverKey: A, startSec: 96, seconds: 30, motion: 'zoom-in' });
    expect(res.status).toBe(202);
    expect(sentEvent()).toEqual({ audioKey: AUDIO, coverKey: A, startSec: 96, seconds: 30, motion: 'zoom-in' });
  });

  it('sends no `motion` field for none — the event keeps its original shape', async () => {
    await post({ coverKey: A, motion: 'none' });
    expect(sentEvent()).toEqual({ audioKey: AUDIO, coverKey: A });
  });

  it('never sends a move with the whole-song vertical', async () => {
    await post({ coverKey: A, full: true, motion: 'zoom-in' });
    expect(sentEvent()).toEqual({ audioKey: AUDIO, coverKey: A, full: true });
  });

  it('refuses a move it does not know', async () => {
    const res = await post({ coverKey: A, motion: 'spin' });
    expect(res.status).toBe(400);
    expect(lambdaSend).not.toHaveBeenCalled();
  });
});

