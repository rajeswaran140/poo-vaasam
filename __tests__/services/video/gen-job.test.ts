/** @jest-environment node */
/**
 * advanceGenJob / cancelGenJob — the money rule under test: exactly ONE settle
 * per reservation, by whichever side wins the conditional job transition, and
 * every won terminal transition releases the shot's VIDLOCK# (Ruling V5).
 */

const mockUpload = jest.fn();
jest.mock('@/infrastructure/storage/s3-client', () => ({
  S3Operations: {
    uploadFile: (...a: unknown[]) => mockUpload(...a),
    getSignedUrl: jest.fn(),
  },
}));

import {
  advanceGenJob,
  cancelGenJob,
  VIDEO_COPY_MAX_FAILURES,
  VIDEO_STALE_MS,
} from '@/services/video/gen-job';
import { candIdForJob } from '@/types/visualStory';
import type { GenJob } from '@/types/visualStory';
import type { VideoGenerationProvider } from '@/services/video/providers/types';

const VS = 'vs_1700000000000_abcdef12';
const JOB = 'gj_1700000000000_abcdef12';
const CAND = candIdForJob(JOB);
const KEY = `audio/mastering/visual-story/${VS}/candidates/${CAND}.mp4`;
const CREATED = '2026-11-05T10:00:00.000Z';
const T0 = Date.parse(CREATED);
const NOW = T0 + 5 * 60_000; // 5 minutes in
const STALE_NOW = T0 + VIDEO_STALE_MS + 1;
const ASSET_URL = 'https://vidgen.x.ai/clip.mp4';

const COPY_FAILED_ERROR = "The clip was made but couldn't be saved; it was still charged.";
const STALE_ERROR = "Grok didn't finish this clip within an hour; it may still have been charged.";

const job = (over: Partial<GenJob> = {}): GenJob => ({
  jobId: JOB,
  sceneOrder: 1,
  shotOrder: 2,
  status: 'running',
  providerId: 'grok',
  providerTaskId: 'req-1',
  reservedUsd: 0.48,
  candId: CAND,
  attempts: 3,
  copyFailures: 0,
  lastPolledAt: null,
  createdAt: CREATED,
  updatedAt: CREATED,
  ...over,
});

const repo = {
  transitionGenJob: jest.fn(),
  touchGenJob: jest.fn(),
  putCandidate: jest.fn(),
  releaseShotVideo: jest.fn(),
  getGenJob: jest.fn(),
  settleGenJob: jest.fn(),
  chooseClipIfPicture: jest.fn(),
};

const provider = {
  id: 'grok',
  model: 'grok-imagine-video-1.5',
  isConfigured: jest.fn(),
  estimateCostUsd: jest.fn(),
  submit: jest.fn(),
  poll: jest.fn(),
};
const prov = provider as unknown as VideoGenerationProvider;

const fetchImpl = jest.fn();
const okResponse = () => ({ ok: true, status: 200, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer });

const succeeded = {
  ok: true,
  state: 'succeeded',
  assets: [{ kind: 'video', url: ASSET_URL, contentType: 'video/mp4' }],
  actualCostUsd: 0.9,
};

let logs: jest.SpyInstance[];
beforeEach(() => {
  jest.resetAllMocks();
  logs = [jest.spyOn(console, 'error').mockImplementation(() => {}), jest.spyOn(console, 'info').mockImplementation(() => {})];
  repo.transitionGenJob.mockImplementation(async (_vs, _id, _from, to, fields) => ({ ...job(), status: to, ...fields }));
  repo.touchGenJob.mockResolvedValue(undefined);
  repo.putCandidate.mockResolvedValue(undefined);
  repo.releaseShotVideo.mockResolvedValue(true);
  repo.settleGenJob.mockResolvedValue(true);
  repo.chooseClipIfPicture.mockResolvedValue(true);
  mockUpload.mockResolvedValue({ key: KEY });
  fetchImpl.mockResolvedValue(okResponse());
});
afterEach(() => {
  logs.forEach((s) => s.mockRestore());
  jest.restoreAllMocks();
});

const advance = (j: GenJob, now = NOW) => advanceGenJob(repo, prov, VS, j, { fetchImpl, now });
const expectReleased = () => expect(repo.releaseShotVideo).toHaveBeenCalledWith(VS, 1, 2, JOB);

describe('constants', () => {
  it('10 copy failures, 1 hour stale', () => {
    expect(VIDEO_COPY_MAX_FAILURES).toBe(10);
    expect(VIDEO_STALE_MS).toBe(60 * 60_000);
  });
});

describe('advanceGenJob', () => {
  it.each(['succeeded', 'failed', 'cancelled'] as const)(
    'a settled %s job is returned as is: no poll, no transition, no settle — only the (idempotent) lock release',
    async (status) => {
      const j = job({ status, settledAt: CREATED, billedUsd: 0.48 });
      expect(await advance(j, STALE_NOW)).toBe(j);
      expect(provider.poll).not.toHaveBeenCalled();
      expect(repo.transitionGenJob).not.toHaveBeenCalled();
      expect(repo.touchGenJob).not.toHaveBeenCalled();
      expect(repo.settleGenJob).not.toHaveBeenCalled();
      // Clears a lock left by a crash between a won transition and its release.
      expect(repo.releaseShotVideo).toHaveBeenCalledTimes(1);
      expectReleased();
    }
  );

  it('a release failure on a terminal job is swallowed', async () => {
    repo.releaseShotVideo.mockRejectedValue(new Error('ddb'));
    const j = job({ status: 'succeeded', settledAt: CREATED });
    expect(await advance(j)).toBe(j);
  });

  it.each(['pending', 'running'] as const)('running + %s → touch (attempts 1 more), no settle, no release', async (state) => {
    provider.poll.mockResolvedValue({ ok: true, state });
    const out = await advance(job({ attempts: 0 }));
    expect(provider.poll).toHaveBeenCalledTimes(1);
    expect(provider.poll).toHaveBeenCalledWith('req-1');
    expect(repo.touchGenJob).toHaveBeenCalledWith(VS, JOB);
    expect(out.status).toBe('running');
    expect(out.attempts).toBe(1);
    expect(repo.transitionGenJob).not.toHaveBeenCalled();
    expect(repo.settleGenJob).not.toHaveBeenCalled();
    expect(repo.releaseShotVideo).not.toHaveBeenCalled();
  });

  it('poll ok:false (network) → touch only, still running', async () => {
    provider.poll.mockResolvedValue({ ok: false, code: 'upstream', error: 'x' });
    const out = await advance(job());
    expect(repo.touchGenJob).toHaveBeenCalledWith(VS, JOB);
    expect(out.status).toBe('running');
    expect(repo.transitionGenJob).not.toHaveBeenCalled();
    expect(repo.settleGenJob).not.toHaveBeenCalled();
  });

  it('poll throwing is treated as a network error → touch only', async () => {
    provider.poll.mockRejectedValue(new Error('boom'));
    const out = await advance(job());
    expect(repo.touchGenJob).toHaveBeenCalledWith(VS, JOB);
    expect(out.status).toBe('running');
    expect(repo.settleGenJob).not.toHaveBeenCalled();
  });

  it('succeeded → fetch (deadline signal) → upload to the exact key → candidate → succeeded → ONE billed settle + release', async () => {
    const timeoutSpy = jest.spyOn(AbortSignal, 'timeout');
    provider.poll.mockResolvedValue(succeeded);
    const out = await advance(job());

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe(ASSET_URL);
    // One deadline for the whole copy: the fetch and the upload share it.
    expect(timeoutSpy).toHaveBeenCalledTimes(1);
    expect(timeoutSpy.mock.calls[0][0]).toBeGreaterThanOrEqual(3_000);
    expect(timeoutSpy.mock.calls[0][0]).toBeLessThanOrEqual(22_000);
    expect(fetchImpl.mock.calls[0][1].signal).toBe(timeoutSpy.mock.results[0].value);
    expect(mockUpload.mock.calls[0][1]).toEqual({ abortSignal: timeoutSpy.mock.results[0].value });

    expect(mockUpload).toHaveBeenCalledTimes(1);
    const up = mockUpload.mock.calls[0][0];
    expect(up.key).toBe(KEY);
    expect(up.contentType).toBe('video/mp4');
    expect(Buffer.from(up.file)).toEqual(Buffer.from([1, 2, 3]));

    expect(repo.putCandidate).toHaveBeenCalledTimes(1);
    const [vsArg, cand] = repo.putCandidate.mock.calls[0];
    expect(vsArg).toBe(VS);
    expect(cand).toEqual({
      candId: CAND,
      sceneOrder: 1,
      shotOrder: 2,
      jobId: JOB,
      providerId: 'grok',
      providerTaskId: 'req-1',
      mode: 'HERO',
      s3Key: KEY,
      costUsd: 0.9,
      createdAt: expect.any(String),
    });

    // Copy happens BEFORE the success transition.
    expect(mockUpload.mock.invocationCallOrder[0]).toBeLessThan(repo.transitionGenJob.mock.invocationCallOrder[0]);
    expect(repo.putCandidate.mock.invocationCallOrder[0]).toBeLessThan(repo.transitionGenJob.mock.invocationCallOrder[0]);
    expect(repo.transitionGenJob).toHaveBeenCalledTimes(1);
    expect(repo.transitionGenJob.mock.calls[0].slice(0, 4)).toEqual([VS, JOB, ['running'], 'succeeded']);

    expect(repo.settleGenJob).toHaveBeenCalledTimes(1);
    expect(repo.settleGenJob).toHaveBeenCalledWith(VS, JOB, { reservedUsd: 0.48, billedUsd: 0.9 }); // xAI's own charge, not the hold
    expectReleased();
    expect(out.status).toBe('succeeded');
  });

  it("records the clip's length on its candidate, so a later change of the row's seconds shows it is out of date", async () => {
    provider.poll.mockResolvedValue(succeeded);
    await advance(job({ durationSec: 8 }));
    expect(repo.putCandidate.mock.calls[0][1]).toEqual(expect.objectContaining({ candId: CAND, durationSec: 8 }));
  });

  it('a job from before lengths were recorded saves a candidate without one', async () => {
    provider.poll.mockResolvedValue(succeeded);
    await advance(job());
    expect(repo.putCandidate.mock.calls[0][1]).not.toHaveProperty('durationSec');
  });

  it('a second advance after success does nothing', async () => {
    provider.poll.mockResolvedValue(succeeded);
    const first = await advance(job());
    jest.clearAllMocks();
    const second = await advance(first);
    expect(second).toBe(first);
    expect(provider.poll).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(mockUpload).not.toHaveBeenCalled();
    expect(repo.transitionGenJob).not.toHaveBeenCalled();
    expect(repo.settleGenJob).not.toHaveBeenCalled();
  });

  it('lost success transition (a concurrent advance won) → no settle, no release, returns the stored job', async () => {
    provider.poll.mockResolvedValue(succeeded);
    repo.transitionGenJob.mockResolvedValue(null);
    const stored = job({ status: 'succeeded' });
    repo.getGenJob.mockResolvedValue(stored);
    const out = await advance(job());
    expect(repo.putCandidate).toHaveBeenCalledTimes(1); // idempotent re-copy is fine
    expect(repo.settleGenJob).not.toHaveBeenCalled();
    expect(repo.releaseShotVideo).not.toHaveBeenCalled();
    expect(out).toEqual(stored);
  });

  it('a settle failure is logged and swallowed', async () => {
    provider.poll.mockResolvedValue(succeeded);
    repo.settleGenJob.mockRejectedValue(new Error('gone'));
    const out = await advance(job());
    expect(out.status).toBe('succeeded');
    expectReleased();
  });

  it('a release failure never skips the settle', async () => {
    provider.poll.mockResolvedValue(succeeded);
    repo.releaseShotVideo.mockRejectedValue(new Error('ddb'));
    const out = await advance(job());
    expect(out.status).toBe('succeeded');
    expect(repo.settleGenJob).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['fetch throws', () => fetchImpl.mockRejectedValue(new Error('timeout'))],
    ['fetch non-2xx', () => fetchImpl.mockResolvedValue({ ok: false, status: 403, arrayBuffer: async () => new ArrayBuffer(1) })],
    ['upload throws', () => mockUpload.mockRejectedValue(new Error('s3'))],
    ['putCandidate throws', () => repo.putCandidate.mockRejectedValue(new Error('ddb'))],
  ])('copy failure (%s) → still running, touch with copyFailed, copyFailures 1, no settle', async (_n, arrange) => {
    arrange();
    provider.poll.mockResolvedValue(succeeded);
    const out = await advance(job());
    expect(repo.touchGenJob).toHaveBeenCalledWith(VS, JOB, { copyFailed: true });
    expect(out.status).toBe('running');
    expect(out.copyFailures).toBe(1);
    expect(repo.transitionGenJob).not.toHaveBeenCalled();
    expect(repo.settleGenJob).not.toHaveBeenCalled();
    expect(repo.releaseShotVideo).not.toHaveBeenCalled();
  });

  it('a 403 body is never uploaded', async () => {
    fetchImpl.mockResolvedValue({ ok: false, status: 403, arrayBuffer: async () => new ArrayBuffer(1) });
    provider.poll.mockResolvedValue(succeeded);
    await advance(job());
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('10th copy failure → failed upstream with the exact copy + ONE BILLED settle + release', async () => {
    fetchImpl.mockRejectedValue(new Error('timeout'));
    provider.poll.mockResolvedValue(succeeded);
    const out = await advance(job({ copyFailures: 9 }));
    expect(repo.touchGenJob).toHaveBeenCalledWith(VS, JOB, { copyFailed: true });
    expect(repo.transitionGenJob).toHaveBeenCalledWith(VS, JOB, ['running'], 'failed', {
      code: 'upstream',
      error: COPY_FAILED_ERROR,
      billedUsd: 0.9,
    });
    expect(repo.settleGenJob).toHaveBeenCalledTimes(1);
    expect(repo.settleGenJob).toHaveBeenCalledWith(VS, JOB, { reservedUsd: 0.48, billedUsd: 0.9 });
    expectReleased();
    expect(out.status).toBe('failed');
    expect(out.error).toBe(COPY_FAILED_ERROR);
  });

  it('10th copy failure with a lost transition → no settle', async () => {
    fetchImpl.mockRejectedValue(new Error('timeout'));
    provider.poll.mockResolvedValue(succeeded);
    repo.transitionGenJob.mockResolvedValue(null);
    repo.getGenJob.mockResolvedValue(job({ status: 'succeeded' }));
    const out = await advance(job({ copyFailures: 9 }));
    expect(repo.settleGenJob).not.toHaveBeenCalled();
    expect(repo.releaseShotVideo).not.toHaveBeenCalled();
    expect(out.status).toBe('succeeded');
  });

  it('moderated (failed content_policy, billed) → failed, BILLED settle, no candidate, release', async () => {
    provider.poll.mockResolvedValue({ ok: true, state: 'failed', code: 'content_policy', error: 'Refused.', billed: true });
    const out = await advance(job());
    expect(repo.transitionGenJob).toHaveBeenCalledWith(VS, JOB, ['running'], 'failed', {
      code: 'content_policy',
      error: 'Refused.',
      billedUsd: 0.48,
    });
    expect(repo.putCandidate).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(repo.settleGenJob).toHaveBeenCalledTimes(1);
    expect(repo.settleGenJob).toHaveBeenCalledWith(VS, JOB, { reservedUsd: 0.48, billedUsd: 0.48 });
    expectReleased();
    expect(out.status).toBe('failed');
    expect(out.code).toBe('content_policy');
  });

  it('expired (failed, unbilled) → failed, UNBILLED settle, release', async () => {
    provider.poll.mockResolvedValue({ ok: true, state: 'failed', code: 'upstream', error: 'Expired.', billed: false });
    const out = await advance(job());
    expect(repo.settleGenJob).toHaveBeenCalledTimes(1);
    expect(repo.settleGenJob).toHaveBeenCalledWith(VS, JOB, { reservedUsd: 0.48, billedUsd: 0 });
    expectReleased();
    expect(out.status).toBe('failed');
  });

  it('provider failed with a lost transition → no settle, no release', async () => {
    provider.poll.mockResolvedValue({ ok: true, state: 'failed', code: 'upstream', error: 'Expired.', billed: false });
    repo.transitionGenJob.mockResolvedValue(null);
    repo.getGenJob.mockResolvedValue(job({ status: 'cancelled' }));
    const out = await advance(job());
    expect(repo.settleGenJob).not.toHaveBeenCalled();
    expect(repo.releaseShotVideo).not.toHaveBeenCalled();
    expect(out.status).toBe('cancelled');
  });

  it('succeeded without a video asset → failed bad_response, billed', async () => {
    provider.poll.mockResolvedValue({ ok: true, state: 'succeeded', assets: [], actualCostUsd: null });
    await advance(job());
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(repo.transitionGenJob.mock.calls[0].slice(2, 4)).toEqual([['running'], 'failed']);
    expect(repo.transitionGenJob.mock.calls[0][4].code).toBe('bad_response');
    expect(repo.settleGenJob).toHaveBeenCalledWith(VS, JOB, { reservedUsd: 0.48, billedUsd: 0.48 });
  });

  describe('stale (Rulings V4, V4b)', () => {
    it('a running job still pending 1 h after createdAt → failed with the exact copy, BILLED, release', async () => {
      provider.poll.mockResolvedValue({ ok: true, state: 'running' });
      const out = await advance(job(), STALE_NOW);
      expect(provider.poll).toHaveBeenCalledTimes(1); // polled first: a late finish is still saved
      expect(repo.transitionGenJob).toHaveBeenCalledWith(VS, JOB, ['submitted', 'running'], 'failed', {
        code: 'upstream',
        error: STALE_ERROR,
        billedUsd: 0.48,
      });
      expect(repo.settleGenJob).toHaveBeenCalledTimes(1);
      expect(repo.settleGenJob).toHaveBeenCalledWith(VS, JOB, { reservedUsd: 0.48, billedUsd: 0.48 });
      expectReleased();
      expect(out.status).toBe('failed');
      expect(out.error).toBe(STALE_ERROR);
    });

    it('a stale running job whose poll errors is ended the same way', async () => {
      provider.poll.mockResolvedValue({ ok: false, code: 'auth', error: 'x' });
      const out = await advance(job(), STALE_NOW);
      expect(out.status).toBe('failed');
      expect(repo.settleGenJob).toHaveBeenCalledWith(VS, JOB, { reservedUsd: 0.48, billedUsd: 0.48 });
    });

    it('a stale running job that finishes on this poll is saved, not failed', async () => {
      provider.poll.mockResolvedValue(succeeded);
      const out = await advance(job(), STALE_NOW);
      expect(out.status).toBe('succeeded');
      expect(repo.transitionGenJob).toHaveBeenCalledTimes(1);
      expect(repo.settleGenJob).toHaveBeenCalledTimes(1);
    });

    it('a stale job whose poll succeeds but whose copy fails stays running (copy retries go on), nothing settled', async () => {
      provider.poll.mockResolvedValue(succeeded);
      fetchImpl.mockRejectedValue(new Error('timeout'));
      const out = await advance(job({ copyFailures: 0 }), STALE_NOW);
      expect(out.status).toBe('running');
      expect(out.copyFailures).toBe(1);
      expect(repo.touchGenJob).toHaveBeenCalledWith(VS, JOB, { copyFailed: true });
      expect(repo.transitionGenJob).not.toHaveBeenCalled();
      expect(repo.settleGenJob).not.toHaveBeenCalled();
      expect(repo.releaseShotVideo).not.toHaveBeenCalled();
    });

    it('a stale job on its 10th copy failure ends with the copy-failed copy, not the stale one', async () => {
      provider.poll.mockResolvedValue(succeeded);
      fetchImpl.mockRejectedValue(new Error('timeout'));
      const out = await advance(job({ copyFailures: 9 }), STALE_NOW);
      expect(repo.transitionGenJob).toHaveBeenCalledTimes(1);
      expect(repo.transitionGenJob).toHaveBeenCalledWith(VS, JOB, ['running'], 'failed', {
        code: 'upstream',
        error: COPY_FAILED_ERROR,
        billedUsd: 0.9,
      });
      expect(repo.settleGenJob).toHaveBeenCalledTimes(1);
      expect(out.error).toBe(COPY_FAILED_ERROR);
    });

    it('a stale submitted job with NO providerTaskId → failed, still BILLED (V4b), release, no poll', async () => {
      const out = await advance(job({ status: 'submitted', providerTaskId: null }), STALE_NOW);
      expect(provider.poll).not.toHaveBeenCalled();
      expect(repo.transitionGenJob).toHaveBeenCalledWith(VS, JOB, ['submitted', 'running'], 'failed', {
        code: 'upstream',
        error: STALE_ERROR,
        billedUsd: 0.48,
      });
      expect(repo.settleGenJob).toHaveBeenCalledWith(VS, JOB, { reservedUsd: 0.48, billedUsd: 0.48 });
      expectReleased();
      expect(out.status).toBe('failed');
    });

    it('a fresh submitted job is left alone', async () => {
      const j = job({ status: 'submitted', providerTaskId: null });
      expect(await advance(j)).toBe(j);
      expect(provider.poll).not.toHaveBeenCalled();
      expect(repo.transitionGenJob).not.toHaveBeenCalled();
    });

    it('a lost stale transition → no settle, no release', async () => {
      provider.poll.mockResolvedValue({ ok: true, state: 'running' });
      repo.transitionGenJob.mockResolvedValue(null);
      repo.getGenJob.mockResolvedValue(job({ status: 'succeeded' }));
      const out = await advance(job(), STALE_NOW);
      expect(repo.settleGenJob).not.toHaveBeenCalled();
      expect(repo.releaseShotVideo).not.toHaveBeenCalled();
      expect(out.status).toBe('succeeded');
    });
  });
});

describe('cancelGenJob', () => {
  it('running with a providerTaskId → cancelled, BILLED settle (Grok may still charge), release', async () => {
    const out = await cancelGenJob(repo, VS, job());
    expect(repo.transitionGenJob).toHaveBeenCalledWith(VS, JOB, ['submitted', 'running'], 'cancelled', { billedUsd: 0.48 });
    expect(repo.settleGenJob).toHaveBeenCalledTimes(1);
    expect(repo.settleGenJob).toHaveBeenCalledWith(VS, JOB, { reservedUsd: 0.48, billedUsd: 0.48 });
    expectReleased();
    expect(out?.status).toBe('cancelled');
  });

  it('submitted with NO providerTaskId → still BILLED (Ruling V6: submit may be in flight), release', async () => {
    repo.transitionGenJob.mockImplementation(async (_vs, _id, _from, to) => ({ ...job({ providerTaskId: null }), status: to }));
    const out = await cancelGenJob(repo, VS, job({ status: 'submitted', providerTaskId: null }));
    expect(repo.settleGenJob).toHaveBeenCalledTimes(1);
    expect(repo.settleGenJob).toHaveBeenCalledWith(VS, JOB, { reservedUsd: 0.48, billedUsd: 0.48 });
    expectReleased();
    expect(out?.status).toBe('cancelled');
  });

  it('a finished job → null, no settle, no release', async () => {
    repo.transitionGenJob.mockResolvedValue(null);
    expect(await cancelGenJob(repo, VS, job({ status: 'succeeded' }))).toBeNull();
    expect(repo.settleGenJob).not.toHaveBeenCalled();
    expect(repo.releaseShotVideo).not.toHaveBeenCalled();
  });
});

describe('I1 — a killed copy still counts; one advance fits a 22 s deadline', () => {
  const flush = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  };

  it('the copy attempt is recorded BEFORE copying: a copy that never resolves has already counted', async () => {
    provider.poll.mockResolvedValue(succeeded);
    fetchImpl.mockReturnValue(new Promise(() => {})); // the platform kills the request mid-copy
    void advance(job());
    await flush();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(repo.touchGenJob).toHaveBeenCalledTimes(1);
    expect(repo.touchGenJob).toHaveBeenCalledWith(VS, JOB, { copyFailed: true });
    expect(repo.touchGenJob.mock.invocationCallOrder[0]).toBeLessThan(fetchImpl.mock.invocationCallOrder[0]);
  });

  it('a failed copy is counted once, not twice', async () => {
    provider.poll.mockResolvedValue(succeeded);
    fetchImpl.mockRejectedValue(new Error('timeout'));
    await advance(job());
    expect(repo.touchGenJob).toHaveBeenCalledTimes(1);
  });

  it('a successful copy still touches first, then succeeds (copyFailures irrelevant)', async () => {
    provider.poll.mockResolvedValue(succeeded);
    const out = await advance(job());
    expect(repo.touchGenJob).toHaveBeenCalledWith(VS, JOB, { copyFailed: true });
    expect(out.status).toBe('succeeded');
  });

  it('the 10th attempt whose copy hangs until the deadline ends billed with the copy-failed copy', async () => {
    provider.poll.mockResolvedValue(succeeded);
    fetchImpl.mockImplementation(
      (_u: string, init: { signal: AbortSignal }) =>
        new Promise((_res, rej) => init.signal.addEventListener('abort', () => rej(new Error('AbortError'))))
    );
    const deadlineSignal = (_ms: number) => {
      const c = new AbortController();
      setTimeout(() => c.abort(), 0);
      return c.signal;
    };
    const out = await advanceGenJob(repo, prov, VS, job({ copyFailures: 9 }), { fetchImpl, now: NOW, deadlineSignal });
    expect(repo.touchGenJob).toHaveBeenCalledWith(VS, JOB, { copyFailed: true });
    expect(repo.transitionGenJob).toHaveBeenCalledWith(VS, JOB, ['running'], 'failed', {
      code: 'upstream',
      error: COPY_FAILED_ERROR,
      billedUsd: 0.9,
    });
    expect(repo.settleGenJob).toHaveBeenCalledWith(VS, JOB, { reservedUsd: 0.48, billedUsd: 0.9 });
    expect(out.status).toBe('failed');
    expect(out.error).toBe(COPY_FAILED_ERROR);
  });

  it('after 10 killed copies (count already 10) the next advance ends it billed without copying again', async () => {
    provider.poll.mockResolvedValue(succeeded);
    const out = await advance(job({ copyFailures: VIDEO_COPY_MAX_FAILURES }));
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(mockUpload).not.toHaveBeenCalled();
    expect(repo.transitionGenJob).toHaveBeenCalledWith(VS, JOB, ['running'], 'failed', {
      code: 'upstream',
      error: COPY_FAILED_ERROR,
      billedUsd: 0.9,
    });
    expect(repo.settleGenJob).toHaveBeenCalledTimes(1);
    expect(out.error).toBe(COPY_FAILED_ERROR);
  });

  it.each([
    [5_000, 17_000],
    [21_000, 3_000],
    [0, 22_000],
  ])('poll took %i ms ⇒ the copy (fetch + upload) gets %i ms', async (pollMs, budget) => {
    let t = 1_000_000;
    const clock = () => t;
    provider.poll.mockImplementation(async () => {
      t += pollMs;
      return succeeded;
    });
    const sig = new AbortController().signal;
    const deadlineSignal = jest.fn(() => sig);
    await advanceGenJob(repo, prov, VS, job(), { fetchImpl, now: NOW, clock, deadlineSignal });
    expect(deadlineSignal).toHaveBeenCalledTimes(1);
    expect(deadlineSignal).toHaveBeenCalledWith(budget);
    expect(fetchImpl.mock.calls[0][1].signal).toBe(sig);
    expect(mockUpload.mock.calls[0][1]).toEqual({ abortSignal: sig });
  });
});

describe('I3 — settlement is atomic and repeatable (Ruling V10)', () => {
  it('without xAI\'s figure, a finished clip bills the hold (over-record, never under)', async () => {
    provider.poll.mockResolvedValue({ ...succeeded, actualCostUsd: null });
    await advance(job());
    expect(repo.settleGenJob).toHaveBeenCalledWith(VS, JOB, { reservedUsd: 0.48, billedUsd: 0.48 });
    expect(repo.putCandidate.mock.calls[0][1].costUsd).toBe(0.48);
  });

  it('settles BEFORE releasing the lock', async () => {
    provider.poll.mockResolvedValue(succeeded);
    await advance(job());
    expect(repo.settleGenJob.mock.invocationCallOrder[0]).toBeLessThan(repo.releaseShotVideo.mock.invocationCallOrder[0]);
  });

  it('the won job carries settledAt, so re-advancing it does nothing', async () => {
    provider.poll.mockResolvedValue(succeeded);
    const out = await advance(job());
    expect(out.settledAt).toEqual(expect.any(String));
    expect(out.billedUsd).toBe(0.9);
  });

  it('a kill after the won transition but before the settle: the next advance settles exactly once; a further one does nothing', async () => {
    provider.poll.mockResolvedValue(succeeded);
    repo.settleGenJob.mockRejectedValueOnce(new Error('killed'));
    const first = await advance(job());
    expect(first.status).toBe('succeeded');
    expect(first.settledAt).toBeUndefined();

    // What the next GET reads back: terminal, billed intent stored, never settled.
    jest.clearAllMocks();
    repo.settleGenJob.mockResolvedValue(true);
    const stored = job({ status: 'succeeded', billedUsd: 0.48 });
    const second = await advance(stored);
    expect(provider.poll).not.toHaveBeenCalled();
    expect(repo.transitionGenJob).not.toHaveBeenCalled();
    expect(repo.settleGenJob).toHaveBeenCalledTimes(1);
    expect(repo.settleGenJob).toHaveBeenCalledWith(VS, JOB, { reservedUsd: 0.48, billedUsd: 0.48 });
    expect(repo.settleGenJob.mock.invocationCallOrder[0]).toBeLessThan(repo.releaseShotVideo.mock.invocationCallOrder[0]);
    expect(second.settledAt).toEqual(expect.any(String));

    jest.clearAllMocks();
    await advance(second);
    expect(repo.settleGenJob).not.toHaveBeenCalled();
  });

  it.each([
    ['clean failed/expired', { status: 'failed' as const, billedUsd: 0 }, 0],
    ['moderated', { status: 'failed' as const, billedUsd: 0.48 }, 0.48],
    ['cancelled', { status: 'cancelled' as const, billedUsd: 0.48 }, 0.48],
    ['no stored intent (over-record)', { status: 'failed' as const }, 0.48],
  ])('early return on an unsettled %s job settles with its stored billed amount', async (_n, over, billed) => {
    await advance(job(over));
    expect(repo.settleGenJob).toHaveBeenCalledWith(VS, JOB, { reservedUsd: 0.48, billedUsd: billed });
  });

  it('early-return settle cancelled by the settledAt condition (false) ⇒ no double count, nothing else', async () => {
    repo.settleGenJob.mockResolvedValue(false);
    const j = job({ status: 'succeeded', billedUsd: 0.48 });
    const out = await advance(j);
    expect(repo.settleGenJob).toHaveBeenCalledTimes(1);
    expect(out).toBe(j);
    expect(repo.transitionGenJob).not.toHaveBeenCalled();
  });

  it('an early-return settle failure is swallowed and the lock is still released', async () => {
    repo.settleGenJob.mockRejectedValue(new Error('ddb'));
    const j = job({ status: 'failed', billedUsd: 0 });
    expect(await advance(j)).toBe(j);
    expectReleased();
  });
});

describe('a finished clip is chosen for its shot (audit 2026-11-09: renders came out as slideshows)', () => {
  it('a copied clip → chooseClipIfPicture for that shot and candidate, and the job still succeeds', async () => {
    provider.poll.mockResolvedValue(succeeded);
    const out = await advance(job());
    expect(out.status).toBe('succeeded');
    expect(repo.chooseClipIfPicture).toHaveBeenCalledTimes(1);
    expect(repo.chooseClipIfPicture).toHaveBeenCalledWith(VS, 1, 2, CAND);
  });
  it('a failed choose is logged and swallowed: the clip is saved and billed as normal', async () => {
    provider.poll.mockResolvedValue(succeeded);
    repo.chooseClipIfPicture.mockRejectedValue(new Error('ddb'));
    const out = await advance(job());
    expect(out.status).toBe('succeeded');
    expect(repo.settleGenJob).toHaveBeenCalledTimes(1);
  });
  it('no choose when the copy fails, or the clip failed or was moderated', async () => {
    provider.poll.mockResolvedValue(succeeded);
    fetchImpl.mockResolvedValue({ ok: false, status: 403, arrayBuffer: async () => new ArrayBuffer(0) });
    await advance(job());
    provider.poll.mockResolvedValue({ ok: true, state: 'failed', code: 'content_policy', error: 'x', billed: true });
    await advance(job());
    expect(repo.chooseClipIfPicture).not.toHaveBeenCalled();
  });
});
