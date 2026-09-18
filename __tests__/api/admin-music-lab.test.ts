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
import { POST as renderPOST } from '@/app/api/admin/music-lab/master/[jobId]/render/route';
import { POST as shortPOST } from '@/app/api/admin/music-lab/master/[jobId]/short/route';
import { GET as statusGET } from '@/app/api/admin/music-lab/master/[jobId]/route';
import { InvokeCommand } from '@aws-sdk/client-lambda';
import * as auth from '@/lib/auth-helper';

const requireAdmin = auth.requireAdmin as jest.Mock;
const MockInvoke = InvokeCommand as unknown as jest.Mock;
const post = (path: string, body: unknown, withBearer = true) =>
  new NextRequest(`https://tamilagaval.com${path}`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: withBearer ? { Authorization: 'Bearer test-token' } : undefined,
  });

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

  it('401s without a Bearer token (CSRF defense on the mutation)', async () => {
    const res = await measurePOST(post('/api/admin/music-lab/measure', { s3Key: 'audio/take.mp3' }, false));
    expect(res.status).toBe(401);
    expect(mockSend).not.toHaveBeenCalled();
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
  // A source lives in the mastering workspace (that is where the upload route
  // puts it); keys outside the prefix are refused, see below.
  const SRC = 'audio/mastering/1700000000000_ab12cd34_take.wav';

  it('creates a job and Event-invokes the worker (202)', async () => {
    const res = await masterPOST(post('/api/admin/music-lab/master', { s3Key: SRC }));
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.status).toBe('queued');
    expect(body.jobId).toBeTruthy();
    // `edit: null` is the "no trim/fade" case — a request that omits it must
    // still produce exactly the job it always did.
    expect(mockCreate).toHaveBeenCalledWith(body.jobId, { s3Key: SRC, target: -14, edit: null, join: null });
    expect(MockInvoke.mock.calls[0][0].InvocationType).toBe('Event');
  });

  it('400s on a bad key (no job, no invoke)', async () => {
    expect((await masterPOST(post('/api/admin/music-lab/master', { s3Key: '../x' }))).status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('refuses a key outside the mastering workspace — no arbitrary object may be mastered', async () => {
    // An admin session must not be able to run the ffmpeg worker against just
    // any bucket object (e.g. a published catalogue track). Only the workspace.
    for (const s3Key of ['audio/take.wav', 'audio/poem-music/published.wav', 'images/x.wav', 'audio/mastering/']) {
      const res = await masterPOST(post('/api/admin/music-lab/master', { s3Key }));
      expect(res.status).toBe(400);
    }
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('ignores a caller-supplied bucket — the worker reads its own TAKES_BUCKET', async () => {
    const res = await masterPOST(
      post('/api/admin/music-lab/master', { s3Key: SRC, bucket: 'attacker-controlled-bucket' })
    );
    expect(res.status).toBe(202);
    // The invoke payload must not carry the bucket the caller tried to inject.
    const payload = JSON.parse(Buffer.from(MockInvoke.mock.calls[0][0].Payload).toString());
    expect(payload).not.toHaveProperty('bucket');
    expect(payload).toEqual({ jobId: expect.any(String), s3Key: SRC, target: -14, edit: null, join: null });
  });

  it('400s rather than silently defaulting when target is unusable', async () => {
    // A string target used to fall through to -14: asking for Apple's -16 and
    // quietly getting -14 is the failure this guards.
    for (const target of ['-16', -100, 0, NaN, null]) {
      const res = await masterPOST(post('/api/admin/music-lab/master', { s3Key: SRC, target }));
      expect(res.status).toBe(400);
    }
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('honours a valid non-default target', async () => {
    const res = await masterPOST(post('/api/admin/music-lab/master', { s3Key: SRC, target: -16 }));
    expect(res.status).toBe(202);
    expect(mockCreate).toHaveBeenCalledWith(expect.any(String), { s3Key: SRC, target: -16, edit: null, join: null });
  });

  it('carries a trim/fade edit through to the job and the worker payload', async () => {
    const edit = { trimStartSec: 2, trimEndSec: 200, fadeInSec: 0, fadeOutSec: 6, curve: 'qsin' };
    const res = await masterPOST(post('/api/admin/music-lab/master', { s3Key: SRC, edit }));
    expect(res.status).toBe(202);
    expect(mockCreate).toHaveBeenCalledWith(expect.any(String), { s3Key: SRC, target: -14, edit, join: null });
    const payload = JSON.parse(Buffer.from(MockInvoke.mock.calls[0][0].Payload).toString());
    expect(payload.edit).toEqual(edit);
  });

  it('stores null for an edit that changes nothing, so the record cannot imply one', async () => {
    const res = await masterPOST(
      post('/api/admin/music-lab/master', {
        s3Key: SRC,
        edit: { trimStartSec: 0, trimEndSec: null, fadeInSec: 0, fadeOutSec: 0, curve: 'tri' },
      })
    );
    expect(res.status).toBe(202);
    expect(mockCreate).toHaveBeenCalledWith(expect.any(String), { s3Key: SRC, target: -14, edit: null, join: null });
  });

  /**
   * Two-part assembly. The guards here matter more than the edit's: `join`
   * carries a SECOND S3 key, so without the same checks Part A gets it would be
   * an unchecked way to point the ffmpeg worker at any object in the bucket.
   */
  describe('join (two-part assembly)', () => {
    const PART_B = 'audio/mastering/1700000000000_ff99_partb.wav';
    const join = (over: Record<string, unknown> = {}) => ({ partBKey: PART_B, overlapSec: 3, ...over });

    it('carries the seam to the job and the worker payload', async () => {
      const res = await masterPOST(post('/api/admin/music-lab/master', { s3Key: SRC, join: join() }));
      expect(res.status).toBe(202);
      const payload = JSON.parse(Buffer.from(MockInvoke.mock.calls[0][0].Payload).toString());
      // Equal power by default — a linear crossfade dips ~3 dB mid-seam.
      expect(payload.join).toMatchObject({ partBKey: PART_B, overlapSec: 3, curve: 'qsin' });
    });

    it('REFUSES a Part B outside the mastering workspace', async () => {
      // The whole point: the worker's role can read the entire bucket.
      for (const partBKey of [
        'audio/poem-music/amma.mp3',
        'audio/mastering/../poem-music/amma.mp3',
        'amma.wav',
      ]) {
        const res = await masterPOST(post('/api/admin/music-lab/master', { s3Key: SRC, join: join({ partBKey }) }));
        expect(res.status).toBe(400);
      }
      expect(mockCreate).not.toHaveBeenCalled();
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('refuses one of its own mastering outputs as Part B', async () => {
      const res = await masterPOST(post('/api/admin/music-lab/master', {
        s3Key: SRC,
        join: join({ partBKey: 'audio/mastering/1700000000000_ab12cd34_take-master-14LUFS.wav' }),
      }));
      expect(res.status).toBe(400);
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('refuses crossfading a file into itself', async () => {
      // This one masters perfectly cleanly and yields a shorter copy of the same
      // song, so nothing downstream would ever flag it.
      const res = await masterPOST(post('/api/admin/music-lab/master', { s3Key: SRC, join: join({ partBKey: SRC }) }));
      expect(res.status).toBe(400);
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('400s on a malformed join rather than failing inside ffmpeg', async () => {
      for (const bad of [
        { overlapSec: 3 },                                  // no Part B
        { partBKey: PART_B },                               // no overlap
        { partBKey: PART_B, overlapSec: 0 },                // degenerate
        { partBKey: PART_B, overlapSec: 999 },              // a mix, not a seam
        { partBKey: PART_B, overlapSec: 3, curve: 'sinc' }, // unknown curve
        { partBKey: PART_B, overlapSec: 3, editB: { trimStartSec: -1 } },
      ]) {
        const res = await masterPOST(post('/api/admin/music-lab/master', { s3Key: SRC, join: bad }));
        expect(res.status).toBe(400);
      }
      expect(mockCreate).not.toHaveBeenCalled();
    });
  });

  it('400s on a malformed edit rather than failing inside ffmpeg a minute later', async () => {
    for (const edit of [
      { trimStartSec: -1 },
      { fadeOutSec: 'six' },
      { fadeOutSec: 999 },
      { trimStartSec: 100, trimEndSec: 40 },
      { fadeOutSec: 3, curve: 'bounce' },
    ]) {
      const res = await masterPOST(post('/api/admin/music-lab/master', { s3Key: SRC, edit }));
      expect(res.status).toBe(400);
    }
    expect(mockCreate).not.toHaveBeenCalled();
    expect(MockInvoke).not.toHaveBeenCalled();
  });

  it('400s on re-mastering a mastering output', async () => {
    // Both are inside the workspace, so they clear the prefix check and must be
    // caught by the re-master guard itself.
    for (const s3Key of [
      'audio/mastering/1700000000000_ab12cd34_take-master-14LUFS.wav',
      'audio/mastering/1700000000000_ab12cd34_take.mp3-master.wav',
    ]) {
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


/**
 * POST /render — build the YouTube video for a saved master.
 *
 * The guard that matters is the cover key: it names a SECOND object the worker
 * will fetch, and that role can read the whole bucket. Everything else defers to
 * planRender, so the route and the worker cannot disagree about what is
 * renderable.
 */
describe('render enqueue', () => {
  const JOB_ID = 'job-1';
  const COVER = 'audio/mastering/1700000000000_cc11_cover.jpg';
  const doneSavedJob = (over: Record<string, unknown> = {}) => ({
    id: JOB_ID,
    status: 'done',
    s3Key: 'audio/mastering/1700000000000_ab12cd34_take.wav',
    masterKey: 'audio/mastering/1700000000000_ab12cd34_take-master-14LUFS.wav',
    mp3Key: 'audio/mastering/1700000000000_ab12cd34_take-master-14LUFS.mp3',
    target: -14,
    savedAt: '2026-08-04T00:00:00.000Z',
    videoKey: null,
    error: null,
    ...over,
  });
  const renderReq = (body: unknown) =>
    renderPOST(post(`/api/admin/music-lab/master/${JOB_ID}/render`, body), {
      params: Promise.resolve({ jobId: JOB_ID }),
    });

  it('queues a render from the MASTER, never the web MP3', async () => {
    mockGet.mockResolvedValueOnce(doneSavedJob());
    const res = await renderReq({ coverKey: COVER });
    expect(res.status).toBe(202);

    const payload = JSON.parse(Buffer.from(MockInvoke.mock.calls[0][0].Payload).toString());
    expect(payload.render.audioKey).toMatch(/\.wav$/);
    expect(payload.render.audioKey).not.toMatch(/\.mp3$/);
    expect(payload.render).toMatchObject({ coverKey: COVER, height: 1440 });
    // A render event carries no source key — it must not look like a master run.
    expect(payload.s3Key).toBeUndefined();
  });

  it('defaults to 1440p, which earns the better audio codec', async () => {
    mockGet.mockResolvedValueOnce(doneSavedJob());
    const res = await renderReq({ coverKey: COVER });
    expect((await res.json()).height).toBe(1440);
  });

  it('REFUSES a cover outside the mastering workspace', async () => {
    for (const coverKey of ['images/song-covers/x.png', 'audio/mastering/../x.png', 'x.png']) {
      mockGet.mockResolvedValueOnce(doneSavedJob());
      const res = await renderReq({ coverKey });
      expect(res.status).toBe(409);
    }
    expect(MockInvoke).not.toHaveBeenCalled();
  });

  it('refuses an unsaved master, and one with no mastered WAV', async () => {
    mockGet.mockResolvedValueOnce(doneSavedJob({ savedAt: null }));
    expect((await renderReq({ coverKey: COVER })).status).toBe(409);

    mockGet.mockResolvedValueOnce(doneSavedJob({ masterKey: null }));
    expect((await renderReq({ coverKey: COVER })).status).toBe(409);
    expect(MockInvoke).not.toHaveBeenCalled();
  });

  it('refuses a height it does not offer', async () => {
    mockGet.mockResolvedValueOnce(doneSavedJob());
    expect((await renderReq({ coverKey: COVER, height: 720 })).status).toBe(409);
    expect(MockInvoke).not.toHaveBeenCalled();
  });

  it('400s without a cover, and 404s an unknown job', async () => {
    expect((await renderReq({})).status).toBe(400);
    mockGet.mockResolvedValueOnce(null);
    expect((await renderReq({ coverKey: COVER })).status).toBe(404);
  });
});


/**
 * POST /short — cut the vertical hook clip for Reels / Instagram / Shorts.
 *
 * The sibling of /render and guarded the same way, for the same reason: the
 * cover key names a second object the worker will fetch with a role that can
 * read the whole bucket. The one property unique to this route is that the
 * event must carry `short` and NOTHING else the worker branches on — a payload
 * that also looked like a render or a master run would do the wrong work.
 */
describe('short enqueue', () => {
  const JOB_ID = 'job-1';
  const COVER = 'audio/mastering/1700000000000_cc11_cover.jpg';
  const doneSavedJob = (over: Record<string, unknown> = {}) => ({
    id: JOB_ID,
    status: 'done',
    s3Key: 'audio/mastering/1700000000000_ab12cd34_take.wav',
    masterKey: 'audio/mastering/1700000000000_ab12cd34_take-master-14LUFS.wav',
    mp3Key: 'audio/mastering/1700000000000_ab12cd34_take-master-14LUFS.mp3',
    target: -14,
    savedAt: '2026-08-04T00:00:00.000Z',
    editedDurationSec: 240,
    shortKey: null,
    error: null,
    ...over,
  });
  const shortReq = (body: unknown) =>
    shortPOST(post(`/api/admin/music-lab/master/${JOB_ID}/short`, body), {
      params: Promise.resolve({ jobId: JOB_ID }),
    });

  it('queues a short from the MASTER, never the web MP3', async () => {
    mockGet.mockResolvedValueOnce(doneSavedJob());
    const res = await shortReq({ coverKey: COVER });
    expect(res.status).toBe(202);

    const payload = JSON.parse(Buffer.from(MockInvoke.mock.calls[0][0].Payload).toString());
    expect(payload.short.audioKey).toMatch(/\.wav$/);
    expect(payload.short.audioKey).not.toMatch(/\.mp3$/);
    expect(payload.short).toMatchObject({ coverKey: COVER });
    // It must not also look like a render or a master run.
    expect(payload.render).toBeUndefined();
    expect(payload.s3Key).toBeUndefined();
    expect((await res.json()).shortKey).toMatch(/-short-1920\.mp4$/);
  });

  it('REFUSES a cover outside the mastering workspace', async () => {
    for (const coverKey of ['images/song-covers/x.png', 'audio/mastering/../x.png', 'x.png']) {
      mockGet.mockResolvedValueOnce(doneSavedJob());
      expect((await shortReq({ coverKey })).status).toBe(409);
    }
    expect(MockInvoke).not.toHaveBeenCalled();
  });

  it('refuses an unsaved master, and one with no mastered WAV', async () => {
    mockGet.mockResolvedValueOnce(doneSavedJob({ savedAt: null }));
    expect((await shortReq({ coverKey: COVER })).status).toBe(409);

    mockGet.mockResolvedValueOnce(doneSavedJob({ masterKey: null }));
    expect((await shortReq({ coverKey: COVER })).status).toBe(409);
    expect(MockInvoke).not.toHaveBeenCalled();
  });

  it('refuses a track shorter than the clip', async () => {
    mockGet.mockResolvedValueOnce(doneSavedJob({ editedDurationSec: 22 }));
    const res = await shortReq({ coverKey: COVER });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/shorter/i);
    expect(MockInvoke).not.toHaveBeenCalled();
  });

  it('400s without a cover, and 404s an unknown job', async () => {
    expect((await shortReq({})).status).toBe(400);
    mockGet.mockResolvedValueOnce(null);
    expect((await shortReq({ coverKey: COVER })).status).toBe(404);
  });

  it('401s without a Bearer token (CSRF defense on the mutation)', async () => {
    const res = await shortPOST(
      post(`/api/admin/music-lab/master/${JOB_ID}/short`, { coverKey: COVER }, false),
      { params: Promise.resolve({ jobId: JOB_ID }) }
    );
    expect(res.status).toBe(401);
    expect(MockInvoke).not.toHaveBeenCalled();
  });

  /**
   * The operator's own window. It reaches the worker as `startSec`/`seconds` on
   * the short event, and its ABSENCE has to survive the trip: the worker
   * branches on `!== undefined` to decide whether to measure at all, so a
   * payload carrying explicit nulls would silently disable the loudness pass.
   */
  describe('a chosen window', () => {
    it('passes the window through to the worker', async () => {
      mockGet.mockResolvedValueOnce(doneSavedJob());
      const res = await shortReq({ coverKey: COVER, startSec: 128.4, seconds: 45 });
      expect(res.status).toBe(202);

      const payload = JSON.parse(Buffer.from(MockInvoke.mock.calls[0][0].Payload).toString());
      expect(payload.short).toMatchObject({ coverKey: COVER, startSec: 128.4, seconds: 45 });
      expect((await res.json()).window).toEqual({ startSec: 128.4, seconds: 45 });
    });

    it('omits the window entirely when none was chosen', async () => {
      mockGet.mockResolvedValueOnce(doneSavedJob());
      await shortReq({ coverKey: COVER });

      const payload = JSON.parse(Buffer.from(MockInvoke.mock.calls[0][0].Payload).toString());
      expect('startSec' in payload.short).toBe(false);
      expect('seconds' in payload.short).toBe(false);
    });

    it('refuses a window outside 30s-3min, and a half-given one', async () => {
      for (const body of [
        { coverKey: COVER, startSec: 10, seconds: 20 },   // under the floor
        { coverKey: COVER, startSec: 10, seconds: 200 },  // past three minutes
        { coverKey: COVER, startSec: 10 },                // no length
        { coverKey: COVER, seconds: 45 },                 // no start
      ]) {
        mockGet.mockResolvedValueOnce(doneSavedJob());
        expect((await shortReq(body)).status).toBe(409);
      }
      expect(MockInvoke).not.toHaveBeenCalled();
    });

    /**
     * The ceiling that was wrong. 60s was a convention applied over the
     * channel's own evidence, and it refused the two-minute clip this song
     * needed.
     */
    it('accepts a two-minute window', async () => {
      mockGet.mockResolvedValueOnce(doneSavedJob({ editedDurationSec: 300 }));
      const res = await shortReq({ coverKey: COVER, startSec: 96, seconds: 120 });
      expect(res.status).toBe(202);
      const payload = JSON.parse(Buffer.from(MockInvoke.mock.calls[0][0].Payload).toString());
      expect(payload.short).toMatchObject({ startSec: 96, seconds: 120 });
    });

    it('refuses a window that runs past the end of the track', async () => {
      mockGet.mockResolvedValueOnce(doneSavedJob({ editedDurationSec: 100 }));
      const res = await shortReq({ coverKey: COVER, startSec: 80, seconds: 30 });
      expect(res.status).toBe(409);
      expect((await res.json()).error).toMatch(/past the end/i);
      expect(MockInvoke).not.toHaveBeenCalled();
    });
  });
});

/**
 * POST /master — the normalization mode.
 *
 * A karaoke bed must keep its headroom for a live voice, and loudnorm cannot
 * deliver that at ANY target: measured on the real Sevvanthi bed it reports
 * Dynamic at -14, -18 and -20 alike, even with linear=true requested. So the
 * mode is a separate axis from the target, not a target value.
 *
 * Task 3 of docs/superpowers/plans/2026-09-18-karaoke-master-target.md.
 */
describe('normalization mode', () => {
  const SOURCE = 'audio/mastering/1700000000000_ab12cd34_take.wav';
  const enqueue = (body: Record<string, unknown>) =>
    masterPOST(post('/api/admin/music-lab/master', { s3Key: SOURCE, target: -14, ...body }));
  const payload = () => JSON.parse(Buffer.from(MockInvoke.mock.calls[0][0].Payload).toString());

  beforeEach(() => mockCreate.mockResolvedValue({ id: 'job-1' }));

  /**
   * ⚠️ The loudness path must stay byte-identical. A field appearing in the
   * payload for every existing caller is a change to a path that was working.
   */
  it('sends NO mode field when none was asked for', async () => {
    expect((await enqueue({})).status).toBe(202);
    expect('normalizationMode' in payload()).toBe(false);
  });

  it('sends no mode field for an explicit loudness request either', async () => {
    expect((await enqueue({ normalizationMode: 'loudness' })).status).toBe(202);
    expect('normalizationMode' in payload()).toBe(false);
  });

  it('carries peak through to the worker and onto the job', async () => {
    expect((await enqueue({ normalizationMode: 'peak' })).status).toBe(202);
    expect(payload().normalizationMode).toBe('peak');
    expect(mockCreate.mock.calls[0][1].normalizationMode).toBe('peak');
  });

  it('400s an unknown mode, naming the two that exist', async () => {
    const res = await enqueue({ normalizationMode: 'karaoke' });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/loudness.*peak|peak.*loudness/);
    expect(MockInvoke).not.toHaveBeenCalled();
  });

  it('400s a mode that is not a string at all', async () => {
    for (const bad of [1, true, {}, []]) {
      expect((await enqueue({ normalizationMode: bad })).status).toBe(400);
    }
    expect(MockInvoke).not.toHaveBeenCalled();
  });

  /**
   * Matchering exists to move a track toward a reference's tonal and loudness
   * profile — the one thing peak mode promises not to do. Refuse, rather than
   * silently preferring one, because a silent preference is how someone ships a
   * bed that was quietly reference-matched.
   */
  it('400s peak together with a reference, rather than preferring one', async () => {
    const res = await enqueue({
      normalizationMode: 'peak',
      referenceKey: 'audio/references/test-ref-v1.wav',
      matchingMethod: 'matched',
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/peak/i);
    expect(MockInvoke).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('400s peak with matchingMethod alone, with no reference key', async () => {
    expect((await enqueue({ normalizationMode: 'peak', matchingMethod: 'both' })).status).toBe(400);
    expect(MockInvoke).not.toHaveBeenCalled();
  });

  it('still allows a reference when the mode is loudness', async () => {
    const res = await enqueue({
      normalizationMode: 'loudness',
      referenceKey: 'audio/references/test-ref-v1.wav',
      matchingMethod: 'matched',
    });
    expect(res.status).toBe(202);
  });
});
