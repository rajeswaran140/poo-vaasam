/** @jest-environment node */
/**
 * POST /api/admin/music-lab/master/[jobId]/render — the video render, and the
 * slideshow that was added to it.
 *
 * The route had no tests before this. What it decides is small but load-bearing:
 * which cover list reaches the worker, and whether an impossible cut is refused
 * here — in a dialog the operator is still looking at — or four minutes later as
 * a line of red text on a row.
 *
 * The event payload is the thing worth pinning. A render with no slideshow must
 * reach the worker in its ORIGINAL shape, because the deployed worker branches
 * on the presence of `covers` and worker deploys are manual: an event that grows
 * a field the running Lambda does not know about renders the wrong video rather
 * than failing.
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

import { POST } from '@/app/api/admin/music-lab/master/[jobId]/render/route';
import type { MasterJob } from '@/types/masterJob';

const AUDIO = 'audio/mastering/1_ab_take-master-14LUFS.wav';
const A = 'audio/mastering/1_cd_a.jpg';
const B = 'audio/mastering/1_cd_b.jpg';
const C = 'audio/mastering/1_cd_c.jpg';
const DURATION = 332; // the real 5:32 master

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

async function render(body: unknown) {
  const req = new Request('http://localhost/api/admin/music-lab/master/j1/render', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
  return POST(req as unknown as import('next/server').NextRequest, { params: Promise.resolve({ jobId: 'j1' }) });
}

/** The `render` object as the worker will receive it. */
const sentEvent = () => {
  const cmd = lambdaSend.mock.calls[0][0] as { args: { Payload: Buffer } };
  return JSON.parse(cmd.args.Payload.toString()).render;
};

const THREE = [
  { coverKey: A, startSec: 0 },
  { coverKey: B, startSec: 130 },
  { coverKey: C, startSec: 240 },
];

describe('the single-image render still sends the old event', () => {
  it('carries no `covers` field at all', async () => {
    // ⚠️ Worker deploys are manual. Until the worker ships, a `covers` field on
    // an ordinary render would be ignored — but the field must also not appear
    // as `undefined` or an empty array, because the worker branches on
    // presence. Absent is the only safe shape.
    const res = await render({ coverKey: A });
    expect(res.status).toBe(202);
    const event = sentEvent();
    expect(event).toEqual({ audioKey: AUDIO, coverKey: A, height: 1440 });
    expect('covers' in event).toBe(false);
  });

  it('treats an empty covers array as no slideshow', async () => {
    await render({ coverKey: A, covers: [] });
    expect('covers' in sentEvent()).toBe(false);
  });
});

describe('the slideshow reaches the worker intact', () => {
  it('forwards the cut list beside the unchanged render fields', async () => {
    const res = await render({ coverKey: A, covers: THREE, durationSec: DURATION });
    expect(res.status).toBe(202);
    expect(sentEvent()).toEqual({ audioKey: AUDIO, coverKey: A, height: 1440, covers: THREE });
  });

  it('refuses a cover that is not the first image, rather than picking one', async () => {
    // The worker records covers[0] as the job's cover, which becomes the
    // thumbnail — while this route validated `coverKey`. Disagreeing means the
    // route reasoned about one image and the job would keep another.
    const res = await render({ coverKey: B, covers: THREE, durationSec: DURATION });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('first image') });
    expect(lambdaSend).not.toHaveBeenCalled();
  });

  it('refuses an impossible cut with the planner\'s wording, not a generic 400', async () => {
    const res = await render({
      coverKey: A,
      covers: [{ coverKey: A, startSec: 0 }, { coverKey: B, startSec: 400 }],
      durationSec: DURATION,
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('after the song ends') });
    expect(lambdaSend).not.toHaveBeenCalled();
  });

  it('says which cap was hit when there are too many images', async () => {
    // The cap lives in the planner. Enforcing it in the zod schema instead made
    // nine covers fail parsing and return "A cover image is required." — true
    // of the schema and useless to the operator.
    const many = Array.from({ length: 9 }, (_, i) => ({ coverKey: A, startSec: i * 10 }));
    const res = await render({ coverKey: A, covers: many, durationSec: DURATION });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('at most') });
  });

  it('refuses a slideshow with no duration to end the last image on', async () => {
    const res = await render({ coverKey: A, covers: THREE });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('length') });
    expect(lambdaSend).not.toHaveBeenCalled();
  });

  it('applies the workspace guard to a later image, not just the first', async () => {
    const res = await render({
      coverKey: A,
      covers: [{ coverKey: A, startSec: 0 }, { coverKey: 'deliveries/theirs.jpg', startSec: 130 }],
      durationSec: DURATION,
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('mastering workspace') });
  });
});

describe('job eligibility is decided once, by the planner', () => {
  it('refuses an unsaved master before looking at the cuts', async () => {
    getMock.mockResolvedValue({ ...baseJob, savedAt: null } as MasterJob);
    const res = await render({ coverKey: A, covers: THREE, durationSec: DURATION });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('Save this master') });
  });

  it('404s an unknown job', async () => {
    getMock.mockResolvedValue(null);
    expect((await render({ coverKey: A })).status).toBe(404);
  });
});
