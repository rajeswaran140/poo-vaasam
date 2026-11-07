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
const clearRenderErrorMock = jest.fn().mockResolvedValue(undefined);
jest.mock('@/infrastructure/database/MasterJobRepository', () => ({
  MasterJobRepository: jest.fn().mockImplementation(() => ({ get: getMock, clearRenderError: clearRenderErrorMock })),
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
  clearRenderErrorMock.mockClear();
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

  /**
   * The route used to REFUSE a slideshow unless the client sent `durationSec`.
   * Nothing sends it reliably: 19 of 91 saved masters have no recorded length
   * at all (2026-10-01), and for those the slideshow was simply unavailable.
   * The worker probes the file and plans the end itself, so the route only
   * needs a length to refuse an impossible cut EARLY — it is not the authority.
   */
  it('checks the cuts against the job\'s own measured length when the client sends none', async () => {
    getMock.mockResolvedValue({ ...baseJob, editedDurationSec: 200 });
    const res = await render({ coverKey: A, covers: THREE }); // third image starts at 240
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('after the song ends') });
    expect(lambdaSend).not.toHaveBeenCalled();
  });

  it('with no length known anywhere, queues the slideshow and leaves the end to the worker', async () => {
    const res = await render({ coverKey: A, covers: THREE });
    expect(res.status).toBe(202);
    expect(sentEvent().covers).toEqual(THREE);
  });

  it('still refuses cuts that are out of order when no length is known', async () => {
    const res = await render({
      coverKey: A,
      covers: [{ coverKey: A, startSec: 0 }, { coverKey: B, startSec: 240 }, { coverKey: C, startSec: 130 }],
    });
    expect(res.status).toBe(409);
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

describe('a crossfade between images', () => {
  it('forwards a crossfade beside the cut list', async () => {
    const res = await render({ coverKey: A, covers: THREE, durationSec: DURATION, transition: 'crossfade' });
    expect(res.status).toBe(202);
    expect(sentEvent().transition).toBe('crossfade');
  });

  it('sends no `transition` field for hard cuts — the event keeps its shape', async () => {
    await render({ coverKey: A, covers: THREE, durationSec: DURATION, transition: 'cut' });
    expect(sentEvent()).not.toHaveProperty('transition');
  });

  it('sends none with a single image, where there is nothing to fade between', async () => {
    await render({ coverKey: A, transition: 'crossfade' });
    expect(sentEvent()).not.toHaveProperty('transition');
  });

  it('refuses a transition it does not know', async () => {
    const res = await render({ coverKey: A, covers: THREE, durationSec: DURATION, transition: 'wipe' });
    expect(res.status).toBe(400);
    expect(lambdaSend).not.toHaveBeenCalled();
  });
});

describe('a video that moves', () => {
  it('forwards the move and renders at 1080p, whatever height was asked for', async () => {
    const res = await render({ coverKey: A, height: 1440, motion: 'zoom-in' });
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.height).toBe(1080);
    expect(body.videoKey).toMatch(/-1080p\.mp4$/);
    expect(sentEvent()).toMatchObject({ height: 1080, motion: 'zoom-in' });
  });

  it('sends no `motion` field for a still video — the event keeps its shape', async () => {
    await render({ coverKey: A, height: 1440, motion: 'none' });
    expect(sentEvent()).not.toHaveProperty('motion');
    expect(sentEvent().height).toBe(1440);
  });

  it('refuses to move a song it already knows is over 8 minutes', async () => {
    getMock.mockResolvedValue({ ...baseJob, editedDurationSec: 510 });
    const res = await render({ coverKey: A, motion: 'pan-left' });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('8 minutes') });
    expect(lambdaSend).not.toHaveBeenCalled();
  });

  it('refuses a move it does not know', async () => {
    const res = await render({ coverKey: A, motion: 'spin' });
    expect(res.status).toBe(400);
    expect(lambdaSend).not.toHaveBeenCalled();
  });
});


/**
 * A video background: a clip or GIF looped under the song. The cover stays —
 * it is what the job records and therefore the YouTube thumbnail — and the
 * background travels beside it as its own field.
 */
describe('a video background', () => {
  const BG = 'audio/mastering/1_ef_loop.mov';

  it('forwards the background beside the cover, at the height asked for', async () => {
    const res = await render({ coverKey: A, backgroundKey: BG, height: 1080 });
    expect(res.status).toBe(202);
    expect(sentEvent()).toEqual({ audioKey: AUDIO, coverKey: A, height: 1080, backgroundKey: BG });
  });

  it('sends no `backgroundKey` field without one — the event keeps its shape', async () => {
    await render({ coverKey: A });
    expect(sentEvent()).not.toHaveProperty('backgroundKey');
  });

  it.each([
    ['outside the workspace', 'images/x.mp4'],
    ['a still image', 'audio/mastering/1_ef_loop.png'],
  ])('refuses a background %s without invoking the worker', async (_label, backgroundKey) => {
    const res = await render({ coverKey: A, backgroundKey });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('That background is not a video or GIF in the mastering workspace.');
    expect(lambdaSend).not.toHaveBeenCalled();
  });

  it.each([
    ['4K', { height: 2160 }, '1080p or 1440p'],
    ['motion', { motion: 'zoom-in' }, 'Motion to None'],
    ['a slideshow', { covers: [{ coverKey: A, startSec: 0 }, { coverKey: B, startSec: 100 }] }, 'slideshow'],
  ])('refuses a background with %s, saying what to change', async (_label, over, words) => {
    const res = await render({ coverKey: A, backgroundKey: BG, ...over });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain(words);
    expect(lambdaSend).not.toHaveBeenCalled();
  });

  it('refuses a song it already knows is over 10 minutes', async () => {
    getMock.mockResolvedValue({ ...baseJob, editedDurationSec: 601 });
    const res = await render({ coverKey: A, backgroundKey: BG });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain('10 minutes');
    expect(lambdaSend).not.toHaveBeenCalled();
  });

  it('still refuses an unsaved master first', async () => {
    getMock.mockResolvedValue({ ...baseJob, savedAt: null });
    const res = await render({ coverKey: A, backgroundKey: BG });
    expect(res.status).toBe(409);
    expect(lambdaSend).not.toHaveBeenCalled();
  });
});

/** Several clips — a story's 10-20, joined in order (2026-11-07). */
describe('several background clips', () => {
  const C1 = 'audio/mastering/visual-story/vs_abc/candidates/c_1.mp4';
  const C2 = 'audio/mastering/visual-story/vs_abc/candidates/c_2.mp4';

  it('forwards the list in order', async () => {
    const res = await render({ coverKey: A, backgroundKeys: [C2, C1, C2], height: 1080 });
    expect(res.status).toBe(202);
    expect(sentEvent()).toEqual({ audioKey: AUDIO, coverKey: A, height: 1080, backgroundKeys: [C2, C1, C2] });
  });

  it('a list of one travels as the single background — the old event shape', async () => {
    await render({ coverKey: A, backgroundKeys: [C1] });
    expect(sentEvent()).toMatchObject({ backgroundKey: C1 });
    expect(sentEvent()).not.toHaveProperty('backgroundKeys');
  });

  it.each([
    ['a clip outside the workspace', { backgroundKeys: [C1, 'images/x.mp4'] }, 'Background clip 2 is not a video or GIF in the mastering workspace.'],
    ['twenty-one clips', { backgroundKeys: Array(21).fill(C1) }, 'Up to 20 background clips can be joined.'],
    ['both fields', { backgroundKeys: [C1, C2], backgroundKey: C1 }, 'Send one background or a list of clips, not both.'],
  ])('refuses %s without invoking the worker', async (_label, over, error) => {
    const res = await render({ coverKey: A, ...over });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(error);
    expect(lambdaSend).not.toHaveBeenCalled();
  });

  it('applies the same rules as one background', async () => {
    const res = await render({ coverKey: A, backgroundKeys: [C1, C2], motion: 'zoom-in' });
    expect(res.status).toBe(409);
    expect(lambdaSend).not.toHaveBeenCalled();
  });
});

/**
 * Audit 2026-11-07, defect 1: a retry that failed with the same message as the
 * last attempt was never reported — the Studio could not tell it from the
 * leftover. The route clears the field on enqueue, so any error afterwards is
 * this attempt's.
 */
describe('a new render clears the previous attempt\'s error', () => {
  it('clears videoError BEFORE invoking the worker', async () => {
    getMock.mockResolvedValue({ ...baseJob, videoError: 'the video render failed' });
    const res = await render({ coverKey: A });
    expect(res.status).toBe(202);
    expect(clearRenderErrorMock).toHaveBeenCalledWith('j1', 'videoError');
    expect(clearRenderErrorMock.mock.invocationCallOrder[0]).toBeLessThan(lambdaSend.mock.invocationCallOrder[0]);
  });

  it('leaves the error alone when the request is refused — the operator may still be reading it', async () => {
    getMock.mockResolvedValue({ ...baseJob, videoError: 'old', masterKey: null });
    const res = await render({ coverKey: A });
    expect(res.status).toBe(409);
    expect(clearRenderErrorMock).not.toHaveBeenCalled();
    expect(lambdaSend).not.toHaveBeenCalled();
  });

  it('does not invoke the worker when the clear fails', async () => {
    clearRenderErrorMock.mockRejectedValueOnce(new Error('ddb down'));
    const res = await render({ coverKey: A });
    expect(res.status).toBe(502);
    expect(lambdaSend).not.toHaveBeenCalled();
  });
});
